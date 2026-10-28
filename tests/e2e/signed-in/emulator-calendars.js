// A stand-in for the providers' calendar servers in the Functions emulator, preloaded only
// by the signed-in e2e suite (tests/e2e/signed-in/run.mjs adds it to NODE_OPTIONS and sets
// SIGNED_IN_FAKE_CALENDARS=1).
//
// Linked calendars (functions/src/events/safe-fetch.ts) resolve a link's host with
// node:dns and fetch it with node:https, refusing every private address, so a local
// server cannot stand in for a provider. Instead, for the hosts below only, this file
// answers the DNS lookup with a public address and the https request with a calendar,
// so the suite never contacts Google and the real fetcher, guards and parser still run.
//
// Why this cannot weaken production:
// - It lives under tests/, outside functions/, so it is never part of the deployed
//   Functions source, and nothing in functions/ requires it.
// - It only patches when FUNCTIONS_EMULATOR is "true" (set only by the Functions
//   emulator) and SIGNED_IN_FAKE_CALENDARS is "1" (set only by run.mjs).
// - Every other host goes to the real node:dns and node:https untouched.
'use strict'

if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.SIGNED_IN_FAKE_CALENDARS === '1') {
  const dns = require('node:dns')
  const https = require('node:https')
  const { EventEmitter } = require('node:events')
  const { Readable } = require('node:stream')

  // Google's host: a secret address answers with a calendar that sends no name of its
  // own, so the card names it by its provider ("Google Calendar"); any other path is 404.
  const GOOGLE = 'calendar.google.com'
  const SECRET_PATH = /^\/calendar\/ical\/[^/]+\/private-[A-Za-z0-9_-]+\/basic\.ics$/
  // Any public address; nothing ever connects to it.
  const PUBLIC_ADDRESS = { address: '142.250.0.1', family: 4 }

  /** Two outdoor events in the coming days (relative to the server's clock). */
  function calendar() {
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    const day = 86_400_000
    const at = days => {
      const start = new Date(Date.now() + days * day)
      start.setUTCHours(17, 0, 0, 0)
      return start.getTime()
    }
    const event = (uid, title, start) =>
      [
        'BEGIN:VEVENT',
        `UID:${uid}@fake-google.test`,
        `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(start + 90 * 60_000)}`,
        `SUMMARY:${title}`,
        'LOCATION:Griffith Park',
        'GEO:34.14;-118.29',
        'END:VEVENT',
      ].join('\r\n')
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Solara e2e//Fake Google//EN',
      event('trail-run', 'Trail run', at(2)),
      event('beach-volleyball', 'Beach volleyball', at(5)),
      'END:VCALENDAR',
      '',
    ].join('\r\n')
  }

  const realLookup = dns.lookup
  dns.lookup = function fakeLookup(hostname, options, callback) {
    if (String(hostname).toLowerCase() !== GOOGLE) return realLookup.apply(this, arguments)
    const done = typeof options === 'function' ? options : callback
    const all = typeof options === 'object' && options !== null && options.all
    process.nextTick(() =>
      all
        ? done(null, [PUBLIC_ADDRESS])
        : done(null, PUBLIC_ADDRESS.address, PUBLIC_ADDRESS.family),
    )
  }

  const realRequest = https.request
  https.request = function fakeRequest(url, options, callback) {
    if (!(url instanceof URL) || url.hostname !== GOOGLE) return realRequest.apply(this, arguments)
    const respond = typeof options === 'function' ? options : callback
    const request = new EventEmitter()
    request.destroy = () => request
    request.end = () => {
      const found = SECRET_PATH.test(url.pathname)
      const response = Readable.from([Buffer.from(found ? calendar() : 'Not Found')])
      response.statusCode = found ? 200 : 404
      response.headers = { 'content-type': found ? 'text/calendar; charset=UTF-8' : 'text/html' }
      process.nextTick(() => respond(response))
      return request
    }
    return request
  }
}
