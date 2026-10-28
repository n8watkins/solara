// Linked calendars' place lookups (src/events/places.ts, REVIEW5 M1): they count against
// a budget of their own, so linked calendars cannot leave guests without place search,
// and each account has a share of that budget.
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { CallerShare } = require('../lib/forecast/caller-share')
const { placeSearchHandler } = require('../lib/forecast/endpoints')
const { PlaceSearchCache } = require('../lib/forecast/place-search')
const { UpstreamBudget } = require('../lib/forecast/upstream-budget')
const { eventPlaceSearch } = require('../lib/events/places')
const { fakeFirestore } = require('./support/fake-firestore')
const { captureLogs } = require('./support/logs')

captureLogs()
const T0 = Date.parse('2026-10-28T14:05:00Z')

function upstream() {
  const net = { calls: 0 }
  const fetchImpl = async () => {
    net.calls += 1
    return {
      ok: true,
      json: async () => ({
        results: [{ name: 'Portland', admin1: 'Oregon', latitude: 45.5, longitude: -122.7 }],
      }),
    }
  }
  return { net, fetchImpl }
}

/** Place search as functions/src/forecast/functions.ts wires it, on the same Firestore. */
function placeSearch(db) {
  const { net, fetchImpl } = upstream()
  const places = new PlaceSearchCache({
    apiKey: () => 'k',
    upstreamAllowed: async () => true,
    upstreamBudget: new UpstreamBudget({
      db,
      label: 'place search',
      prefix: 'places-',
      limits: () => ({ perHour: 200, perDay: 2000 }),
      now: () => T0,
    }),
    now: () => T0,
    fetchImpl,
  })
  const share = new CallerShare({ db, scope: 'places', perHour: () => 20, now: () => T0 })
  return { net, handler: placeSearchHandler({ enabled: () => true, places, share }) }
}

test('accounts whose calendars invent places spend only the linked calendar budget; guests keep place search', async () => {
  const db = fakeFirestore()
  const { net, fetchImpl } = upstream()
  const searchPlace = eventPlaceSearch({
    db,
    apiKey: () => 'k',
    upstreamAllowed: async () => true,
    limits: () => ({ perHour: 50, perDay: 300 }),
    perAccountPerHour: () => 10,
    now: () => T0,
    fetchImpl,
  })
  // REVIEW5's probe: ten accounts, each looking up 25 new texts this hour.
  let looked = 0
  for (let account = 0; account < 10; account += 1) {
    for (let i = 0; i < 25; i += 1) {
      try {
        await searchPlace(`attacker-${account}`, `Nowhere ${account}-${i}`)
        looked += 1
      } catch {}
    }
  }
  assert.equal(looked, 50)
  assert.equal(net.calls, 50)
  assert.ok(db.docs.has('forecastUpstream/event-places-hour-2026-10-28T14'))
  assert.equal(db.docs.has('forecastUpstream/places-hour-2026-10-28T14'), false)

  // A guest then searches for a town as usual.
  const guest = placeSearch(db)
  const found = await guest.handler({
    headers: { 'x-forwarded-for': '198.51.100.9' },
    socket: {},
    query: { name: 'Portland' },
  })
  assert.equal(found.body.results[0].name, 'Portland')
  assert.equal(guest.net.calls, 1)
})

test('one account gets its share of lookups an hour, and a cached text costs nothing', async () => {
  const db = fakeFirestore()
  const { net, fetchImpl } = upstream()
  const searchPlace = eventPlaceSearch({
    db,
    apiKey: () => 'k',
    upstreamAllowed: async () => true,
    limits: () => ({ perHour: 50, perDay: 300 }),
    perAccountPerHour: () => 10,
    now: () => T0,
    fetchImpl,
  })
  let ok = 0
  for (let i = 0; i < 15; i += 1) {
    try {
      await searchPlace('alice', `Town ${i}`)
      ok += 1
    } catch {}
  }
  assert.equal(ok, 10)
  // Already looked up: answered from the cache, outside the share.
  assert.equal((await searchPlace('alice', 'Town 3'))[0].name, 'Portland')
  // Another account has its own share.
  assert.equal((await searchPlace('bob', 'Town 99'))[0].name, 'Portland')
  assert.equal(net.calls, 11)
})
