// Request bodies over the limit, and compressed bodies of any size, never reach the
// Functions Framework's parsers (REVIEW8 SEC L1, REVIEW9 SEC9 H1). These tests run the real framework, the layer Cloud Run runs: the
// deployed entry point in a child process exactly as production starts it, and an echo
// function in this process to check what the parsers receive.
const { after, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const zlib = require('node:zlib')

const functionsFramework = require('@google-cloud/functions-framework')
const { getTestServer } = require('@google-cloud/functions-framework/testing')

const {
  DEFAULT_MAX_BODY_BYTES,
  LARGEST_MAX_BODY_BYTES,
  MAX_BODY_BYTES,
  guardsTarget,
  isEncodedBody,
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
    // A new connection each time: a kept-alive one the server closed while the test was
    // busy compressing would end the next request with "socket hang up".
    const req = http.request(
      { host: '127.0.0.1', port, method, path: '/', headers, agent: false },
      res => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
        res.on('error', error => resolve({ status: res.statusCode, error }))
      },
    )
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

/** A JSON array of zeros `mb` MB long: tiny once compressed, huge once unpacked. */
function bomb(mb) {
  return Buffer.concat([
    Buffer.from('['),
    Buffer.alloc(mb * 1024 * 1024 - 3, '0,'),
    Buffer.from('0]'),
  ])
}

/** The same body compressed with each encoding the parsers unpack. */
function compressed(json) {
  return {
    gzip: zlib.gzipSync(json, { level: 9 }),
    deflate: zlib.deflateSync(json, { level: 9 }),
    br: zlib.brotliCompressSync(json, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }),
  }
}

const ENCODED_ANSWER = {
  error: 'Compressed requests are not accepted',
  code: 'unsupported-encoding',
}

describe('compressed bodies', () => {
  test('only no header or identity, in any case, counts as a plain body', () => {
    assert.equal(isEncodedBody(undefined), false)
    for (const value of ['identity', 'IDENTITY', 'Identity', ' identity ']) {
      assert.equal(isEncodedBody(value), false, value)
    }
    for (const value of [
      'gzip',
      'GZIP',
      'x-gzip',
      'deflate',
      'Deflate',
      'br',
      'BR',
      'zstd',
      'compress',
      'gzip, br',
      'identity, gzip',
      'gzip,identity',
      '',
      ['identity', 'gzip'],
    ]) {
      assert.equal(isEncodedBody(value), true, JSON.stringify(value))
    }
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

  test('answers 415 to any compressed body, small or stacked or in any case, without running the function', async () => {
    const json = bomb(2)
    const bodies = compressed(json)
    const cases = [
      ['gzip', bodies.gzip],
      ['deflate', bodies.deflate],
      ['br', bodies.br],
      ['GZip', bodies.gzip],
      ['BR', bodies.br],
      ['DEFLATE', bodies.deflate],
      ['gzip, br', zlib.brotliCompressSync(bodies.gzip)],
      ['identity, gzip', bodies.gzip],
      ['zstd', Buffer.from('{}')],
    ]
    for (const [encoding, body] of cases) {
      assert.ok(body.length <= LIMIT * 8, `${encoding}: ${body.length} bytes`)
      const before = calls.length
      for (const chunked of [false, true]) {
        const answer = await request(port, {
          headers: {
            'content-type': 'application/json',
            'content-encoding': encoding,
            ...(chunked ? {} : { 'content-length': String(body.length) }),
          },
          send: req => req.end(body),
        })
        assert.equal(answer.status, 415, `${encoding} ${chunked ? 'chunked' : 'declared'}`)
        assert.deepEqual(JSON.parse(answer.text), ENCODED_ANSWER)
        assert.equal(answer.headers.connection, 'close')
      }
      assert.equal(calls.length, before, `${encoding}: the function never runs`)
    }
    // One declared over the limit is refused before its first byte is read.
    const unsent = await request(port, {
      headers: { 'content-encoding': 'gzip', 'content-length': String(LIMIT + 1) },
      send: req => req.flushHeaders(),
    })
    assert.equal(unsent.status, 415)
    assert.deepEqual(JSON.parse(unsent.text), ENCODED_ANSWER)
  })

  test('passes a body that says identity, in any case', async () => {
    for (const encoding of ['identity', 'IDENTITY']) {
      const answer = await request(port, {
        headers: { 'content-type': 'text/plain', 'content-encoding': encoding },
        send: req => req.end('hello'),
      })
      assert.equal(answer.status, 200, encoding)
      assert.deepEqual(JSON.parse(answer.text), { bytes: 5 })
    }
  })

  test('logs a flood of compressed bodies once a minute', async () => {
    for (let i = 0; i < 20; i += 1) {
      await request(port, {
        headers: { 'content-encoding': 'br', 'content-length': '20' },
        send: req => req.end(Buffer.alloc(20)),
      })
    }
    const lines = logs.entries.filter(entry => entry.message === 'compressed request body refused')
    assert.ok(lines.length <= 1, `${lines.length} lines`)
    for (const line of lines) assert.equal(line.severity, 'WARNING')
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

describe('a server that is not guarded (an event-driven function)', () => {
  test('passes any body through untouched', async t => {
    const seen = []
    const server = http.createServer()
    server.on(
      'request',
      limitRequestBodies(
        (req, res) => {
          let bytes = 0
          req.on('data', chunk => (bytes += chunk.length))
          req.on('end', () => {
            seen.push(bytes)
            res.end(String(bytes))
          })
        },
        () => 8,
        () => false,
      ),
    )
    const port = await listen(server)
    t.after(() => server.close())
    const answer = await request(port, {
      headers: { 'content-encoding': 'gzip', 'content-length': '1024' },
      send: req => req.end(Buffer.alloc(1024)),
    })
    assert.equal(answer.status, 200)
    assert.deepEqual(seen, [1024])
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

  /** The child's resident memory in MB, where Linux reports it. */
  function residentMB(pid) {
    try {
      const status = require('node:fs').readFileSync(`/proc/${pid}/status`, 'utf8')
      return Number(/VmHWM:\s+(\d+)/.exec(status)?.[1]) / 1024
    } catch {
      return undefined
    }
  }

  test('refuses the REVIEW9 SEC9 H1 compressed bodies before they are unpacked', async t => {
    const subscriptions = await start('eventSubscriptions')
    t.after(() => subscriptions.child.kill())
    const webhook = await start('stripeWebhook')
    t.after(() => webhook.child.kill())
    const small = compressed(bomb(8))
    const large = compressed(bomb(200))
    // The probe's bodies: 8 MB in about 20 bytes of brotli, 200 MB in 334.
    assert.ok(small.br.length < 100 && large.br.length < 1000)
    const cases = [
      [subscriptions, 'gzip', small.gzip],
      [subscriptions, 'br', small.br],
      [subscriptions, 'deflate', small.deflate],
      [webhook, 'br', large.br],
      [webhook, 'Gzip', large.gzip],
      [webhook, 'DEFLATE', large.deflate],
      [webhook, 'gzip, br', zlib.brotliCompressSync(large.gzip)],
    ]
    for (const [server, encoding, body] of cases) {
      const answers = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server.port, {
            headers: {
              'content-type': 'application/json',
              'content-encoding': encoding,
              'content-length': String(body.length),
              'stripe-signature': 't=1,v1=00',
              origin: 'https://solara-uv.web.app',
            },
            send: req => req.end(body),
          }),
        ),
      )
      for (const answer of answers) {
        // Within the limit, the body is discarded unread by the parsers, so the sender
        // always gets the answer, never a reset connection.
        assert.ok(body.length <= 256 * 1024, `${encoding}: ${body.length} bytes`)
        assert.equal(answer.status, 415, `${encoding}: ${answer.status ?? answer.error}`)
        assert.equal(JSON.parse(answer.text).code, 'unsupported-encoding')
      }
    }
    // Nothing was unpacked: before the fix the webhook's process reached 1.9 GB.
    for (const { child } of [subscriptions, webhook]) {
      const peak = residentMB(child.pid)
      if (peak !== undefined) assert.ok(peak < 400, `peak ${Math.round(peak)} MB`)
    }
    // A plain Stripe-sized body still reaches the signature check.
    const plain = await request(webhook.port, {
      headers: { 'content-type': 'application/json', 'content-encoding': 'identity' },
      send: req => req.end('{}'),
    })
    assert.equal(plain.status, 400)
  })

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

describe('which functions are guarded', () => {
  test('every HTTP function, no event-driven one, and any request when the target is unknown', () => {
    // Loaded last: loading the entry point installs the guard on this process's servers.
    process.env.GCLOUD_PROJECT ??= 'demo-solara'
    const functions = require('..')
    const entries = Object.entries(functions)
    assert.ok(entries.length > 10)
    for (const [name, fn] of entries) {
      assert.equal(guardsTarget(name), Boolean(fn.__endpoint.httpsTrigger), name)
    }
    assert.equal(guardsTarget('reapplyReminderScheduled'), false)
    assert.equal(guardsTarget('stripeWebhook'), true)
    assert.equal(guardsTarget(undefined), true)
    assert.equal(guardsTarget(''), true)
  })

  test('the installed guard follows FUNCTION_TARGET: an event-driven function sees any body', async () => {
    // A child installs the guard as index.ts does and serves an echo listener, so the
    // decision is the installed one, without a Firestore event to deliver.
    const script = `
      const http = require('node:http')
      require(${JSON.stringify(path.join(__dirname, '../lib/shared/body-limit'))}).installRequestBodyLimit()
      const server = http.createServer((req, res) => {
        let bytes = 0
        req.on('data', chunk => (bytes += chunk.length))
        req.on('end', () => res.end(String(bytes)))
      })
      server.listen(0, '127.0.0.1', () => console.log(server.address().port))
    `
    for (const [target, expected] of [
      ['reapplyReminderScheduled', 200],
      ['budgetAlert', 200],
      ['stripeWebhook', 415],
      ['eventSubscriptions', 415],
    ]) {
      const child = spawn(process.execPath, ['-e', script], {
        env: { ...process.env, FUNCTION_TARGET: target },
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      try {
        const port = await new Promise((resolve, reject) => {
          child.stdout.once('data', data => resolve(Number(String(data).trim())))
          child.once('exit', code => reject(new Error(`exited ${code}`)))
        })
        // Larger than any HTTP limit, as a Firestore event on a large document would be.
        const body = Buffer.alloc(300 * 1024, ' ')
        const answer = await request(port, {
          headers: { 'content-encoding': 'gzip', 'content-length': String(body.length) },
          send: req => req.end(body),
        })
        assert.equal(answer.status, expected, target)
        if (expected === 200) assert.equal(answer.text, String(body.length))
      } finally {
        child.kill()
      }
    }
  })
})
