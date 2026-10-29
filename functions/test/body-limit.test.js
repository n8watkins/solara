// Request bodies over the limit never reach the Functions Framework's parsers
// (REVIEW8 SEC L1). These tests run the real framework, the layer Cloud Run runs: the
// deployed entry point in a child process exactly as production starts it, and an echo
// function in this process to check what the parsers receive.
const { after, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const functionsFramework = require('@google-cloud/functions-framework')
const { getTestServer } = require('@google-cloud/functions-framework/testing')

const {
  DEFAULT_MAX_BODY_BYTES,
  LARGEST_MAX_BODY_BYTES,
  MAX_BODY_BYTES,
  limitRequestBodies,
  maxBodyBytesFor,
} = require('../lib/shared/body-limit')
const { captureLogs } = require('./support/logs')

const logs = captureLogs()

/** @param {import('node:http').Server} server */
function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () =>
      resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port),
    )
  })
}

/**
 * Sends a request and resolves with the answer, or with the error that ended it.
 * `send` writes the body; the request stays open until the answer (or close) arrives.
 */
function request(port, { method = 'POST', headers = {}, send = req => req.end() } = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, method, path: '/', headers }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
      res.on('error', error => resolve({ status: res.statusCode, error }))
    })
    req.on('error', error => resolve({ error }))
    send(req)
  })
}

describe('body limits per function', () => {
  test('8 KiB for every endpoint but the Stripe webhook, the largest when unknown', () => {
    assert.equal(DEFAULT_MAX_BODY_BYTES, 8 * 1024)
    assert.equal(maxBodyBytesFor('eventSubscriptions'), 8 * 1024)
    assert.equal(maxBodyBytesFor('deleteAccount'), 8 * 1024)
    assert.equal(maxBodyBytesFor('stripeWebhook'), 256 * 1024)
    assert.equal(maxBodyBytesFor('toString'), 8 * 1024)
    assert.equal(maxBodyBytesFor(undefined), LARGEST_MAX_BODY_BYTES)
    assert.equal(LARGEST_MAX_BODY_BYTES, Math.max(...Object.values(MAX_BODY_BYTES), 8 * 1024))
  })
})

describe('guarded Functions Framework server', () => {
  const LIMIT = 1024
  /** @type {{ bytes: number }[]} */
  const calls = []
  /** @type {import('node:http').Server} */
  let server
  let port = 0

  before(async () => {
    functionsFramework.http('echo', (req, res) => {
      calls.push({ bytes: req.rawBody?.length ?? 0 })
      res.json({ bytes: req.rawBody?.length ?? 0 })
    })
    server = getTestServer('echo')
    // The framework's own Express app, behind the guard, as index.ts installs it.
    const [app] = server.listeners('request')
    server.removeAllListeners('request')
    server.on(
      'request',
      limitRequestBodies(/** @type {any} */ (app), () => LIMIT),
    )
    port = await listen(server)
  })

  after(() => server.close())

  test('passes bodies up to the limit, declared or chunked, whole', async () => {
    const body = Buffer.alloc(LIMIT, 'a')
    const declared = await request(port, {
      headers: { 'content-type': 'text/plain', 'content-length': String(LIMIT) },
      send: req => req.end(body),
    })
    assert.equal(declared.status, 200)
    assert.deepEqual(JSON.parse(declared.text), { bytes: LIMIT })
    const chunked = await request(port, {
      headers: { 'content-type': 'text/plain' },
      send: req => {
        req.write(body.subarray(0, 600))
        req.end(body.subarray(600))
      },
    })
    assert.equal(chunked.status, 200)
    assert.deepEqual(JSON.parse(chunked.text), { bytes: LIMIT })
    const empty = await request(port, { method: 'GET' })
    assert.equal(empty.status, 200)
  })

  test('answers 413 to a declared length over the limit without reading the body', async () => {
    const before = calls.length
    // The body is never sent: the answer must not wait for it.
    const answer = await request(port, {
      headers: { 'content-type': 'application/json', 'content-length': String(30 * 1024 * 1024) },
      send: req => req.flushHeaders(),
    })
    assert.equal(answer.status, 413)
    assert.deepEqual(JSON.parse(answer.text), {
      error: 'Request too large',
      code: 'payload-too-large',
    })
    assert.equal(answer.headers.connection, 'close')
    assert.equal(calls.length, before, 'the function never runs')
  })

  test('stops a chunked body at the limit, answers 413 and closes the connection', async () => {
    const before = calls.length
    let closed = false
    const answer = await request(port, {
      headers: { 'content-type': 'application/json' },
      send: req => {
        req.on('close', () => (closed = true))
        // Just over the limit, then keep the request open as a slow sender would.
        req.write(Buffer.alloc(LIMIT + 1, '1'))
      },
    })
    assert.equal(answer.status, 413)
    assert.deepEqual(JSON.parse(answer.text), {
      error: 'Request too large',
      code: 'payload-too-large',
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(closed, 'the connection is closed')
    assert.equal(calls.length, before, 'the function never runs')
  })

  test('logs a flood of oversized bodies once a minute', async () => {
    for (let i = 0; i < 20; i += 1) {
      await request(port, {
        headers: { 'content-length': String(LIMIT + 1) },
        send: req => req.flushHeaders(),
      })
    }
    const lines = logs.entries.filter(entry => entry.message === 'request body too large')
    assert.ok(lines.length <= 1, `${lines.length} lines`)
    for (const line of lines) assert.equal(line.severity, 'WARNING')
  })
})

describe('deployed entry point under the real Functions Framework', () => {
  const functionsDir = path.join(__dirname, '..')
  const main = path.join(
    functionsDir,
    'node_modules/@google-cloud/functions-framework/build/src/main.js',
  )

  /** Starts the framework on lib/index.js for `target`, as Cloud Run does. */
  async function start(target) {
    const free = http.createServer()
    const port = await listen(free)
    await new Promise(resolve => free.close(resolve))
    const child = spawn(
      process.execPath,
      [
        main,
        `--target=${target}`,
        `--source=${path.join(functionsDir, 'lib/index.js')}`,
        `--port=${port}`,
      ],
      {
        env: {
          ...process.env,
          GCLOUD_PROJECT: 'demo-solara',
          FUNCTION_TARGET: target,
          NODE_ENV: 'production',
        },
        stdio: 'ignore',
      },
    )
    for (let i = 0; i < 100; i += 1) {
      const probe = await request(port, { method: 'OPTIONS' })
      if (probe.status) return { child, port }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    child.kill()
    throw new Error(`${target} did not start`)
  }

  test('refuses an oversized body before parsing, at each function own limit', async t => {
    const subscriptions = await start('eventSubscriptions')
    t.after(() => subscriptions.child.kill())
    const tooLarge = await request(subscriptions.port, {
      headers: { 'content-type': 'application/json', 'content-length': String(8 * 1024 + 1) },
      send: req => req.flushHeaders(),
    })
    assert.equal(tooLarge.status, 413)
    assert.equal(JSON.parse(tooLarge.text).code, 'payload-too-large')
    const chunked = await request(subscriptions.port, {
      headers: { 'content-type': 'application/json' },
      send: req => req.write(`[${'1,'.repeat(8 * 1024)}1`),
    })
    assert.equal(chunked.status, 413)
    // A body within the limit reaches the function (refused later for App Check).
    const small = await request(subscriptions.port, {
      headers: { 'content-type': 'application/json', origin: 'https://solara-uv.web.app' },
      send: req => req.end('{}'),
    })
    assert.notEqual(small.status, 413)

    const webhook = await start('stripeWebhook')
    t.after(() => webhook.child.kill())
    const event = await request(webhook.port, {
      headers: { 'content-type': 'application/json', 'content-length': String(100 * 1024) },
      send: req => req.end(Buffer.alloc(100 * 1024, ' ')),
    })
    assert.equal(event.status, 400, 'a Stripe-sized body reaches the signature check')
    const huge = await request(webhook.port, {
      headers: { 'content-type': 'application/json', 'content-length': String(256 * 1024 + 1) },
      send: req => req.flushHeaders(),
    })
    assert.equal(huge.status, 413)
  })
})
