// Fetching linked calendars (src/events/safe-fetch.ts): server-side request forgery
// guards, redirects, size, time and content checks, with a fake resolver and transport.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createServer } = require('node:net')
const { gzipSync } = require('node:zlib')

const {
  fetchCalendar,
  httpsTransport,
  isPublicAddress,
  looksLikeCalendar,
  publicAddresses,
} = require('../lib/events/safe-fetch')

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
