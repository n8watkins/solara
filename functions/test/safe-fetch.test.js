// Fetching linked calendars (src/events/safe-fetch.ts): server-side request forgery
// guards, redirects, size, time and content checks, with a fake resolver and transport.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { Readable } = require('node:stream')
const { createServer } = require('node:net')
const { brotliCompressSync, gzipSync } = require('node:zlib')

const {
  BodyTooLargeError,
  fetchCalendar,
  httpsTransport,
  isPublicAddress,
  looksLikeCalendar,
  publicAddresses,
  readBoundedBody,
  withDeadline,
} = require('../lib/events/safe-fetch')
const { localTransport, startTlsServer } = require('./support/tls-server')

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
const PUBLIC = [{ address: '93.184.216.34', family: 4 }]

const resolver =
  (table = {}) =>
  async host => {
    if (host in table) return table[host]
    return PUBLIC
  }

function response(status, headers = {}, body = '') {
  const chunks = Buffer.isBuffer(body) ? [body] : body ? [Buffer.from(body)] : []
  const stream = Readable.from(chunks)
  return { status, headers, body: stream }
}

/** A transport that answers by URL and records every request. */
function transport(routes) {
  const calls = []
  const fn = async request => {
    calls.push(request)
    const route = routes[request.url.href]
    if (!route) throw new Error(`unexpected request ${request.url.href}`)
    return typeof route === 'function' ? route(request) : route
  }
  fn.calls = calls
  return fn
}

describe('public addresses', () => {
  test('refuses every private, local, metadata and special-purpose address', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      '2002:a00:1::1',
      '2001:db8::1',
      '2001::1',
      'fe80::1%eth0',
      'not-an-ip',
    ]) {
      assert.equal(isPublicAddress(address), false, address)
    }
  })

  test('allows public IPv4 and global IPv6', () => {
    assert.equal(isPublicAddress('93.184.216.34'), true)
    assert.equal(isPublicAddress('8.8.8.8'), true)
    assert.equal(isPublicAddress('2606:4700::6810:84e5'), true)
  })

  test('one private answer blocks a host, and local names never resolve', async () => {
    await assert.rejects(
      publicAddresses(
        'mixed.example.com',
        resolver({
          'mixed.example.com': [
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.5', family: 4 },
          ],
        }),
      ),
      { name: 'BlockedAddressError' },
    )
    let asked = false
    const spy = async () => {
      asked = true
      return PUBLIC
    }
    await assert.rejects(publicAddresses('metadata.google.internal', spy), {
      name: 'BlockedAddressError',
    })
    await assert.rejects(publicAddresses('printer.local', spy), { name: 'BlockedAddressError' })
    await assert.rejects(publicAddresses('169.254.169.254', spy), { name: 'BlockedAddressError' })
    assert.equal(asked, false)
    assert.deepEqual(await publicAddresses('93.184.216.34', spy), [
      { address: '93.184.216.34', family: 4 },
    ])
  })
})

describe('httpsTransport', () => {
  test('connects to the checked address, never asking DNS again', async () => {
    // `.invalid` never resolves, so reaching this server proves the checked address was used.
    let connected = false
    const server = createServer(socket => {
      connected = true
      socket.destroy()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      await assert.rejects(
        httpsTransport({
          url: new URL(`https://calendar.invalid:${port}/a.ics`),
          addresses: [{ address: '127.0.0.1', family: 4 }],
          headers: {},
          signal: AbortSignal.timeout(5000),
        }),
      )
      assert.equal(connected, true)
    } finally {
      server.close()
    }
  })
})

describe('fetchCalendar', () => {
  test('reads a calendar and connects only to the checked addresses', async () => {
    const send = transport({
      'https://cal.example.com/a.ics': response(
        200,
        { 'content-type': 'text/calendar; charset=utf-8', etag: '"v1"' },
        ICS,
      ),
    })
    const result = await fetchCalendar('webcal://cal.example.com/a.ics', {
      resolve: resolver(),
      transport: send,
    })
    assert.deepEqual(result, {
      ok: true,
      notModified: false,
      text: ICS,
      etag: '"v1"',
      lastModified: null,
    })
    assert.deepEqual(send.calls[0].addresses, PUBLIC)
    // No cookies or credentials, only the fixed headers.
    assert.deepEqual(Object.keys(send.calls[0].headers).sort(), [
      'Accept',
      'Accept-Encoding',
      'User-Agent',
    ])
  })

  test('refuses a link that resolves to a private address', async () => {
    const send = transport({})
    const result = await fetchCalendar('https://rebind.example.com/a.ics', {
      resolve: resolver({ 'rebind.example.com': [{ address: '127.0.0.1', family: 4 }] }),
      transport: send,
    })
    assert.deepEqual(result, { ok: false, error: 'blocked-address' })
    assert.equal(send.calls.length, 0)
  })

  test('checks every redirect, and stops after three', async () => {
    const toPrivate = transport({
      'https://a.example.com/x': response(302, { location: 'https://internal.example.com/x' }),
    })
    assert.deepEqual(
      await fetchCalendar('https://a.example.com/x', {
        resolve: resolver({ 'internal.example.com': [{ address: '10.0.0.8', family: 4 }] }),
        transport: toPrivate,
      }),
      { ok: false, error: 'blocked-address' },
    )
    assert.equal(toPrivate.calls.length, 1)

    const toHttp = transport({
      'https://a.example.com/x': response(301, { location: 'http://a.example.com/x' }),
    })
    assert.deepEqual(
      await fetchCalendar('https://a.example.com/x', { resolve: resolver(), transport: toHttp }),
      { ok: false, error: 'not-https' },
    )

    const toMetadataIp = transport({
      'https://a.example.com/x': response(307, { location: 'https://169.254.169.254/latest' }),
    })
    assert.deepEqual(
      await fetchCalendar('https://a.example.com/x', {
        resolve: resolver(),
        transport: toMetadataIp,
      }),
      { ok: false, error: 'blocked-address' },
    )

    const loop = transport({
      'https://a.example.com/1': response(302, { location: '/2' }),
      'https://a.example.com/2': response(302, { location: '/3' }),
      'https://a.example.com/3': response(302, { location: '/4' }),
      'https://a.example.com/4': response(302, { location: '/5' }),
    })
    assert.deepEqual(
      await fetchCalendar('https://a.example.com/1', { resolve: resolver(), transport: loop }),
      { ok: false, error: 'too-many-redirects' },
    )
    assert.equal(loop.calls.length, 4)

    const three = transport({
      'https://a.example.com/1': response(302, { location: '/2' }),
      'https://a.example.com/2': response(302, { location: 'https://b.example.com/3' }),
      'https://b.example.com/3': response(302, { location: '/4' }),
      'https://b.example.com/4': response(200, { 'content-type': 'text/calendar' }, ICS),
    })
    const followed = await fetchCalendar('https://a.example.com/1', {
      resolve: resolver(),
      transport: three,
    })
    assert.equal(followed.ok, true)
  })

  test('sends validators only to the stored link and reads a 304 as unchanged', async () => {
    const send = transport({
      'https://cal.example.com/a.ics': response(304),
    })
    const result = await fetchCalendar('https://cal.example.com/a.ics', {
      etag: '"v1"',
      lastModified: 'Mon, 15 Jun 2026 10:00:00 GMT',
      resolve: resolver(),
      transport: send,
    })
    assert.deepEqual(result, { ok: true, notModified: true })
    assert.equal(send.calls[0].headers['If-None-Match'], '"v1"')
  })

  test('refuses HTML, error statuses and bodies that are not calendars', async () => {
    const html = transport({
      'https://cal.example.com/a': response(200, { 'content-type': 'text/html' }, '<html>'),
    })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', { resolve: resolver(), transport: html }),
      { ok: false, error: 'not-calendar' },
    )
    const plain = transport({
      'https://cal.example.com/a': response(200, { 'content-type': 'text/plain' }, 'hello'),
    })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', { resolve: resolver(), transport: plain }),
      { ok: false, error: 'not-calendar' },
    )
    const missing = transport({ 'https://cal.example.com/a': response(404) })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', { resolve: resolver(), transport: missing }),
      { ok: false, error: 'http-status' },
    )
  })

  test('stops reading past the size limit, also after decompression', async () => {
    const big = 'BEGIN:VCALENDAR\r\n' + 'X'.repeat(2048)
    const declared = transport({
      'https://cal.example.com/a': response(200, { 'content-length': '5000000' }, ICS),
    })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', {
        resolve: resolver(),
        transport: declared,
      }),
      { ok: false, error: 'too-large' },
    )
    const streamed = transport({ 'https://cal.example.com/a': response(200, {}, big) })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', {
        resolve: resolver(),
        transport: streamed,
        maxBytes: 1024,
      }),
      { ok: false, error: 'too-large' },
    )
    // A small gzip that inflates far past the limit (a decompression bomb).
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024, 'A'))
    const gz = transport({
      'https://cal.example.com/a': response(200, { 'content-encoding': 'gzip' }, bomb),
    })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', { resolve: resolver(), transport: gz }),
      { ok: false, error: 'too-large' },
    )
    const zipped = transport({
      'https://cal.example.com/a': response(
        200,
        { 'content-encoding': 'gzip', 'content-type': 'text/calendar' },
        gzipSync(ICS),
      ),
    })
    const read = await fetchCalendar('https://cal.example.com/a', {
      resolve: resolver(),
      transport: zipped,
    })
    assert.equal(read.ok && !read.notModified && read.text, ICS)
  })

  test('gives up when the whole fetch takes longer than the deadline', async () => {
    const slow = transport({
      'https://cal.example.com/a': request =>
        new Promise((_, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    })
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', {
        resolve: resolver(),
        transport: slow,
        timeoutMs: 50,
      }),
      { ok: false, error: 'timeout' },
    )
  })

  test('unreachable hosts and refused links are reported, never thrown', async () => {
    const failing = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    }
    assert.deepEqual(
      await fetchCalendar('https://nowhere.example.com/a', {
        resolve: failing,
        transport: transport({}),
      }),
      { ok: false, error: 'unreachable' },
    )
    assert.deepEqual(await fetchCalendar('https://user:pw@cal.example.com/a'), {
      ok: false,
      error: 'credentials',
    })
  })

  test('recognises a calendar body', () => {
    assert.equal(looksLikeCalendar('﻿  BEGIN:VCALENDAR\r\n'), true)
    assert.equal(looksLikeCalendar('<!doctype html>'), false)
  })
})

/**
 * Runs `fn` and returns the unhandled rejections it caused (each one would make the
 * Functions Framework exit the instance with code 16, REVIEW5 H1).
 */
async function unhandledDuring(fn) {
  const seen = []
  const record = error => seen.push(error)
  process.on('unhandledRejection', record)
  try {
    const result = await fn()
    // Rejections are reported a turn after they happen; give them a moment.
    await new Promise(resolve => setTimeout(resolve, 100))
    return { result, unhandled: seen }
  } finally {
    process.off('unhandledRejection', record)
  }
}

describe('hostile calendar sites over real TLS (REVIEW5 H1)', () => {
  const CAL = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
  const bomb = gzipSync(Buffer.concat([Buffer.from(CAL), Buffer.alloc(16 * 1024 * 1024, 'A')]))
  const routes = {
    '/ok': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar' })
      res.end(CAL)
    },
    '/ok-gzip': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' })
      res.end(gzipSync(CAL))
    },
    // Says gzip, sends text: the decoder fails with "incorrect header check".
    '/gzip-corrupt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' })
      res.write('this is not gzip at all, just text pretending')
      setTimeout(() => res.end(), 200)
    },
    // A gzip bomb sent in small pieces, so the limit is hit while the reader waits.
    '/gzip-bomb-slow': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' })
      let at = 0
      const timer = setInterval(() => {
        if (at >= bomb.length) {
          clearInterval(timer)
          res.end()
          return
        }
        res.write(bomb.subarray(at, (at += 4096)))
      }, 5)
      res.on('close', () => clearInterval(timer))
    },
    '/br-bomb': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'br' })
      res.end(brotliCompressSync(Buffer.alloc(32 * 1024 * 1024, 'A')))
    },
    // Valid gzip, trickled one byte at a time past the deadline.
    '/gzip-trickle': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' })
      const zipped = gzipSync(CAL + 'X'.repeat(10_000))
      let at = 0
      const timer = setInterval(() => res.write(zipped.subarray(at, ++at)), 20)
      res.on('close', () => clearInterval(timer))
    },
    // Drops the connection halfway through a compressed body.
    '/gzip-reset': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' })
      const zipped = gzipSync(CAL + randomBytes(64 * 1024).toString('hex'))
      res.write(zipped.subarray(0, zipped.length / 2))
      setTimeout(() => req.socket.destroy(), 50)
    },
  }
  let server
  let transport
  const fetchFrom = (path, options = {}) =>
    fetchCalendar(`https://calendar.example.com${path}`, {
      resolve: resolver(),
      transport,
      ...options,
    })

  test('setup', async () => {
    server = await startTlsServer(routes)
    transport = localTransport(server.port)
  })

  test('reads a plain and a gzipped calendar', async () => {
    const plain = await fetchFrom('/ok')
    assert.equal(plain.ok && !plain.notModified && plain.text, CAL)
    const zipped = await fetchFrom('/ok-gzip')
    assert.equal(zipped.ok && !zipped.notModified && zipped.text, CAL)
  })

  test('a corrupt gzip body is refused without an unhandled rejection', async () => {
    const { result, unhandled } = await unhandledDuring(() => fetchFrom('/gzip-corrupt'))
    assert.deepEqual(result, { ok: false, error: 'not-calendar' })
    assert.deepEqual(unhandled, [])
  })

  test('a slowly sent gzip bomb ends as too-large at once, without an unhandled rejection', async () => {
    const started = Date.now()
    const { result, unhandled } = await unhandledDuring(() => fetchFrom('/gzip-bomb-slow'))
    assert.deepEqual(result, { ok: false, error: 'too-large' })
    assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`)
    assert.deepEqual(unhandled, [])
  })

  test('a brotli bomb ends as too-large', async () => {
    const { result, unhandled } = await unhandledDuring(() => fetchFrom('/br-bomb'))
    assert.deepEqual(result, { ok: false, error: 'too-large' })
    assert.deepEqual(unhandled, [])
  })

  test('the deadline stops a compressed body that never finishes', async () => {
    const started = Date.now()
    const { result, unhandled } = await unhandledDuring(() =>
      fetchFrom('/gzip-trickle', { timeoutMs: 400 }),
    )
    assert.deepEqual(result, { ok: false, error: 'timeout' })
    assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started} ms`)
    assert.deepEqual(unhandled, [])
  })

  test('a connection dropped inside a compressed body is unreachable', async () => {
    const { result, unhandled } = await unhandledDuring(() => fetchFrom('/gzip-reset'))
    assert.deepEqual(result, { ok: false, error: 'unreachable' })
    assert.deepEqual(unhandled, [])
  })

  test('teardown', async () => {
    await server.close()
  })
})

describe('readBoundedBody and withDeadline', () => {
  test('a decoder error and the size limit reject the one promise returned', async () => {
    const { result, unhandled } = await unhandledDuring(async () => {
      const outcomes = []
      for (const [encoding, body, maxBytes] of [
        ['gzip', Buffer.from('not gzip'), 1024],
        ['deflate', Buffer.from('not deflate'), 1024],
        ['br', Buffer.from('not brotli at all'), 1024],
        ['gzip', gzipSync(Buffer.alloc(1024 * 1024, 'A')), 4096],
      ]) {
        try {
          await readBoundedBody(Readable.from([body]), {
            contentEncoding: encoding,
            maxBytes,
            signal: new AbortController().signal,
          })
          outcomes.push('read')
        } catch (error) {
          outcomes.push(error instanceof BodyTooLargeError ? 'too-large' : 'error')
        }
      }
      return outcomes
    })
    assert.deepEqual(result, ['error', 'error', 'error', 'too-large'])
    assert.deepEqual(unhandled, [])
  })

  test('an abort settles the read even when the source never yields again', async () => {
    const controller = new AbortController()
    const destroyed = []
    const stuck = {
      async *[Symbol.asyncIterator]() {
        yield gzipSync('BEGIN:VCALENDAR').subarray(0, 4)
        await new Promise(() => {})
      },
      destroy: () => destroyed.push(true),
    }
    setTimeout(() => controller.abort(new Error('deadline')), 50)
    await assert.rejects(
      readBoundedBody(stuck, {
        contentEncoding: 'gzip',
        maxBytes: 1024,
        signal: controller.signal,
      }),
      /deadline|abort/i,
    )
    assert.deepEqual(destroyed, [true])
  })

  test('withDeadline settles on time even when the work ignores its signal', async () => {
    const started = Date.now()
    const result = await withDeadline(
      50,
      () => new Promise(() => {}),
      () => 'timed out',
    )
    assert.equal(result, 'timed out')
    assert.ok(Date.now() - started < 1_000)
    assert.equal(
      await withDeadline(
        1_000,
        async () => 'done',
        () => 'timed out',
      ),
      'done',
    )
    // Work that fails after the deadline leaves nothing unhandled.
    const { unhandled } = await unhandledDuring(() =>
      withDeadline(
        10,
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 30)),
        () => null,
      ),
    )
    assert.deepEqual(unhandled, [])
  })

  test('fetchCalendar settles at its deadline even with a transport that ignores the signal', async () => {
    const deaf = async () => new Promise(() => {})
    const started = Date.now()
    assert.deepEqual(
      await fetchCalendar('https://cal.example.com/a', {
        resolve: resolver(),
        transport: deaf,
        timeoutMs: 50,
      }),
      { ok: false, error: 'timeout' },
    )
    assert.ok(Date.now() - started < 1_000)
  })
})
