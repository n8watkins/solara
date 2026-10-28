// REVIEW4 H1, M1 and L7: a fair forecast budget. These tests started as the review's
// probes (handoff/review4-probes/probe-budget-dos.test.js), which drive the deployed
// request pipeline (createApiHandler with App Check stubbed as valid) and asserted the
// broken behaviour; here they assert the fixed one.
const { beforeEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { openMeteoFree } = require('../core/index.js')
const {
  BROWSER_SHARE_OF_UPSTREAM,
  CallerShare,
  browserUpstreamLimits,
  shareScopes,
} = require('../lib/forecast/caller-share')
const { commercialProvider, feedForecastProvider } = require('../lib/forecast/config')
const { forecastHandler, placeSearchHandler } = require('../lib/forecast/endpoints')
const { PlaceSearchCache } = require('../lib/forecast/place-search')
const {
  BUDGET_LAST_GOOD_MAX_AGE_MS,
  ForecastCache,
  LAST_GOOD_MAX_AGE_MS,
} = require('../lib/forecast/proxy')
const { UpstreamBudget } = require('../lib/forecast/upstream-budget')
const { addressScopes, clientScopes } = require('../lib/shared/client-address')
const { createApiHandler } = require('../lib/shared/http')
const { FixedWindowLimiter } = require('../lib/shared/rate-limit')
const { fakeFirestore } = require('./support/fake-firestore')
const { captureLogs } = require('./support/logs')

const logs = captureLogs()
const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-27T14:05:00Z')
const ORIGIN = 'https://solara-uv.web.app'

const body = () => ({
  timezone: 'UTC',
  current: { time: '2026-10-27T07:00', uv_index: 3, temperature_2m: 18, weathercode: 1 },
  hourly: {
    time: ['2026-10-27T07:00'],
    uv_index: [3],
    temperature_2m: [18],
    weathercode: [1],
    cloudcover: [1],
  },
})

/** Upstream stand-in that counts calls. */
function upstream() {
  const net = { calls: 0, fail: false }
  net.fetchImpl = async () => {
    net.calls += 1
    if (net.fail) return { ok: false, status: 503 }
    return { ok: true, json: async () => body() }
  }
  return net
}

/** The deployed forecast stack (functions/src/forecast/functions.ts) on a fake Firestore. */
function forecastStack({
  db = fakeFirestore(),
  clock,
  net = upstream(),
  perHour = 1500,
  limits = () => ({ perHour, perDay: 20000 }),
} = {}) {
  const budget = new UpstreamBudget({ db, limits, now: clock })
  const cache = new ForecastCache({
    db,
    provider: () => commercialProvider('k'),
    upstreamAllowed: async () => true,
    upstreamBudget: budget,
    now: clock,
    fetchImpl: net.fetchImpl,
  })
  const share = new CallerShare({ db, scope: 'forecast', perHour: () => 20, now: clock })
  return { db, net, budget, cache, share }
}

/** The forecast endpoint's request pipeline, as browserApi builds it. */
function endpoint({ cache, share }, { perAddressPerMinute = 120 } = {}) {
  return createApiHandler({
    name: 'forecast',
    method: 'GET',
    allowedOrigin: () => ORIGIN,
    appCheck: () => ({ verifyToken: async () => ({}) }),
    appCheckMode: 'standard',
    perAddressPerMinute,
    fallbackMessage: 'Forecast unavailable',
    handler: forecastHandler({ enabled: () => true, cache, share }),
  })
}

async function call(handler, ip, query) {
  const res = {
    code: 0,
    body: undefined,
    set() {
      return res
    },
    status(code) {
      res.code = code
      return res
    },
    json(value) {
      res.body = value
      return res
    },
    send() {
      return res
    },
  }
  await handler(
    {
      method: 'GET',
      headers: { 'x-forwarded-for': ip, 'x-firebase-appcheck': 'one-replayed-token' },
      socket: {},
      query,
    },
    res,
  )
  return res
}

/** The n-th distinct cache cell (0.02 degree apart). */
const cell = n => ({ lat: (-40 + (n % 4000) * 0.02).toFixed(2), lon: String(-100 + (n >> 12)) })
const LOS_ANGELES = { lat: '34.05', lon: '-118.24' }

describe('fair forecast budget (REVIEW4 H1)', () => {
  let t
  const clock = () => t
  beforeEach(() => {
    t = T0
  })

  test('one address with one App Check token gets its share, not the hour; others still get forecasts', async () => {
    // The probe: 13 minutes of 120 requests a minute for new cells from one address got
    // all 1,500 calls of the hour, and then a real person got 503.
    const stack = forecastStack({ clock })
    let fresh = 0
    let handler
    for (let minute = 0; minute < 13; minute += 1) {
      // The limiter's window uses the wall clock; a fresh pipeline per simulated minute
      // stands in for the window resetting (same cache, budget and shares).
      handler = endpoint(stack)
      for (let i = 0; i < 120; i += 1) {
        if ((await call(handler, '203.0.113.66', cell(minute * 120 + i))).code === 200) fresh += 1
      }
      t += 60_000
    }
    assert.equal(fresh, 20)
    assert.equal(stack.net.calls, 20)
    // Another person, in a place nobody looked at this hour, gets a fresh forecast.
    const res = await call(handler, '198.51.100.20', LOS_ANGELES)
    assert.equal(res.code, 200)
    assert.equal(res.body.stale, undefined)
    assert.equal(stack.net.calls, 21)
    // Past its share, the attacker costs no further Firestore transaction on this instance.
    const transactions = stack.db.stats.transactions
    for (let i = 0; i < 50; i += 1) await call(handler, '203.0.113.66', cell(5000 + i))
    assert.equal(stack.db.stats.transactions, transactions)
    // The share is per UTC hour.
    t += HOUR
    assert.equal((await call(endpoint(stack), '203.0.113.66', cell(9000))).code, 200)
  })

  test('the share counts across instances, and the counter ids hold no address', async () => {
    const db = fakeFirestore()
    const net = upstream()
    const first = forecastStack({ db, clock, net })
    const second = forecastStack({ db, clock, net })
    let ok = 0
    for (let i = 0; i < 30; i += 1) {
      const stack = i % 2 ? first : second
      if ((await call(endpoint(stack), '203.0.113.66', cell(i))).code === 200) ok += 1
    }
    assert.equal(ok, 20)
    // One counter for the address and one for its /24 (REVIEW5 L1).
    const ids = [...db.docs.keys()].filter(id => id.includes('caller-'))
    assert.equal(ids.length, 2)
    for (const id of ids) {
      assert.match(id, /^forecastUpstream\/caller-forecast-2026-10-27T14-[0-9a-f]{32}$/)
      assert.equal(db.docs.get(id).count, 20)
      assert.ok(db.docs.get(id).expireAt instanceof Date)
    }
    assert.doesNotMatch(ids.join(), /203/)
  })

  test('an IPv6 /48 gets four shares in all, however many /64s it uses', async () => {
    const stack = forecastStack({ clock })
    let ok = 0
    for (let n = 0; n < 400; n += 1) {
      // A new /64 of the same /48 for every request, so the per-address limit never bites.
      const res = await call(endpoint(stack), `2001:db8:1:${n.toString(16)}::1`, cell(n))
      if (res.code === 200) ok += 1
    }
    assert.equal(ok, 80)
    assert.equal(stack.net.calls, 80)
  })

  test('serves the last good copy, up to 12 hours old and flagged stale, while the share or budget is spent', async () => {
    const stack = forecastStack({ clock, perHour: 10 })
    const handler = () => endpoint(stack)
    assert.equal((await call(handler(), '198.51.100.20', LOS_ANGELES)).code, 200)

    // Ten hours later the global budget is spent by others (ten new cells this hour).
    t += 10 * HOUR
    for (let i = 0; i < 10; i += 1) await call(handler(), `192.0.2.${i}`, cell(i))
    assert.equal(stack.net.calls, 11)
    const res = await call(handler(), '198.51.100.20', LOS_ANGELES)
    assert.equal(res.code, 200)
    assert.equal(res.body.stale, true)
    assert.equal(res.body.fetchedAt, new Date(T0).toISOString())
    assert.deepEqual(res.body.hourly.uv_index, [3])
    assert.ok(10 * HOUR > LAST_GOOD_MAX_AGE_MS)

    // Past 12 hours there is nothing to serve.
    t = T0 + BUDGET_LAST_GOOD_MAX_AGE_MS + 1
    stack.cache.clear()
    stack.budget.clear()
    for (let i = 0; i < 10; i += 1) await call(handler(), `192.0.2.${i}`, cell(100 + i))
    assert.equal((await call(handler(), '198.51.100.20', LOS_ANGELES)).code, 503)
  })

  test('a failing provider still serves the last good copy for only 6 hours', async () => {
    const stack = forecastStack({ clock })
    await stack.cache.get({ lat: 34.05, lon: -118.24 })
    stack.net.fail = true
    t += 7 * HOUR
    await assert.rejects(stack.cache.get({ lat: 34.05, lon: -118.24 }), { code: 'unavailable' })
  })

  test("a spent budget is known in memory, so callers' shares are not charged for nothing", async () => {
    const stack = forecastStack({ clock, perHour: 10 })
    for (let i = 0; i < 11; i += 1) await call(endpoint(stack), `192.0.2.${i}`, cell(i))
    const transactions = stack.db.stats.transactions
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await call(endpoint(stack), `198.51.100.${i}`, cell(500 + i))).code, 503)
    }
    assert.equal(stack.db.stats.transactions, transactions)
  })

  test('fails closed when the shares cannot be read', async () => {
    const db = fakeFirestore({ failTransactions: true })
    const share = new CallerShare({ db, scope: 'forecast', perHour: () => 20, now: clock })
    assert.equal(await share.take(addressScopes('203.0.113.66')), false)
    assert.ok(logs.entries.some(entry => entry.message === 'caller share could not be read'))
  })
})

describe('networks and the reserve (REVIEW5 L1)', () => {
  let t
  const clock = () => t
  beforeEach(() => {
    t = T0
  })

  test('an IPv4 address also counts against its /24 at four shares', () => {
    assert.deepEqual(shareScopes(addressScopes('203.0.113.9')), [
      { key: '203.0.113.9', weight: 1 },
      { key: '203.0.113.0/24', weight: 4 },
    ])
    assert.deepEqual(shareScopes(addressScopes('::ffff:203.0.113.9')).at(-1), {
      key: '203.0.113.0/24',
      weight: 4,
    })
    // IPv6 (already /64 and /48) and accounts are unchanged.
    assert.deepEqual(
      shareScopes(addressScopes('2001:db8:1:2::9')),
      addressScopes('2001:db8:1:2::9'),
    )
    assert.deepEqual(shareScopes([{ key: 'uid:abc', weight: 1 }]), [{ key: 'uid:abc', weight: 1 }])
  })

  test('75 addresses of one network get 80 upstream calls, not the hour', async () => {
    // The review's probe: 75 IPv4 addresses x 20 new cells spent all 1,500 calls.
    const stack = forecastStack({ clock })
    let fresh = 0
    let n = 0
    for (let a = 0; a < 75; a += 1) {
      const handler = endpoint(stack)
      for (let i = 0; i < 20; i += 1, n += 1) {
        if ((await call(handler, `192.0.2.${a}`, cell(n))).code === 200) fresh += 1
      }
    }
    assert.equal(fresh, 80)
    assert.equal(stack.net.calls, 80)
    const res = await call(endpoint(stack), '198.51.100.20', LOS_ANGELES)
    assert.equal(res.code, 200)
    assert.equal(res.body.stale, undefined)
  })

  test('callers in many networks spend only the browser part; the feed and heads-ups keep the rest', async () => {
    const db = fakeFirestore()
    const limits = () => ({ perHour: 1500, perDay: 20000 })
    const stack = forecastStack({ db, clock, limits: () => browserUpstreamLimits(limits()) })
    assert.deepEqual(browserUpstreamLimits(limits()), { perHour: 1000, perDay: 13333 })
    assert.equal(BROWSER_SHARE_OF_UPSTREAM, 2 / 3)
    let fresh = 0
    let n = 0
    // 100 addresses, each in its own /24, 20 new cells each: 2,000 asks.
    for (let a = 0; a < 100; a += 1) {
      const handler = endpoint(stack)
      for (let i = 0; i < 20; i += 1, n += 1) {
        if ((await call(handler, `10.${a}.7.1`, cell(n))).code === 200) fresh += 1
      }
    }
    assert.equal(fresh, 1000)
    // The server's own budget (the feed's and the heads-ups', the same counters at the
    // full limits) still has the last 500 calls of the hour.
    const server = new UpstreamBudget({ db, limits, now: clock })
    let granted = 0
    for (let i = 0; i < 600; i += 1) if (await server.take()) granted += 1
    assert.equal(granted, 500)
  })
})

describe('place search has its own budget (REVIEW4 H1)', () => {
  function placeStack(db, { perHour = 1500 } = {}) {
    const net = { calls: 0 }
    const budget = new UpstreamBudget({
      db,
      label: 'place search',
      prefix: 'places-',
      limits: () => ({ perHour, perDay: 20000 }),
      now: () => T0,
    })
    const places = new PlaceSearchCache({
      apiKey: () => 'k',
      upstreamAllowed: async () => true,
      upstreamBudget: budget,
      now: () => T0,
      fetchImpl: async () => {
        net.calls += 1
        return { ok: true, json: async () => ({ results: [] }) }
      },
    })
    const share = new CallerShare({ db, scope: 'places', perHour: () => 20, now: () => T0 })
    const handler = createApiHandler({
      name: 'placeSearch',
      method: 'GET',
      allowedOrigin: () => ORIGIN,
      appCheck: () => ({ verifyToken: async () => ({}) }),
      appCheckMode: 'standard',
      perAddressPerMinute: 1_000_000,
      fallbackMessage: 'Place search unavailable',
      handler: placeSearchHandler({ enabled: () => true, places, share }),
    })
    return { net, handler }
  }

  test('random place names cannot spend the forecasts, and forecasts cannot spend the searches', async () => {
    // The probe: 1,500 random searches spent the shared budget, and a forecast then failed.
    const db = fakeFirestore()
    const places = placeStack(db, { perHour: 200 })
    let searched = 0
    for (let i = 0; i < 1500; i += 1) {
      const res = await call(places.handler, `192.0.${i >> 8}.${i & 255}`, {
        name: 'zz' + i.toString(36),
      })
      if (res.code === 200) searched += 1
    }
    assert.equal(searched, 200)
    assert.equal(places.net.calls, 200)
    assert.ok(logs.entries.some(e => e.message === 'place search upstream budget exhausted'))

    const forecasts = forecastStack({ db, clock: () => T0, perHour: 5 })
    const res = await call(endpoint(forecasts), '198.51.100.20', LOS_ANGELES)
    assert.equal(res.code, 200)

    // And the other way round: with the forecasts' hour spent, searches still work.
    for (let i = 0; i < 10; i += 1) await call(endpoint(forecasts), `192.0.2.${i}`, cell(i))
    assert.equal((await call(endpoint(forecasts), '198.51.100.21', cell(99))).code, 503)
    const fresh = placeStack(db, { perHour: 400 })
    assert.equal((await call(fresh.handler, '198.51.100.20', { name: 'Pasadena' })).code, 200)
    assert.ok(db.docs.has('forecastUpstream/places-hour-2026-10-27T14'))
    assert.ok(db.docs.has('forecastUpstream/hour-2026-10-27T14'))
  })

  test('one caller gets its share of new searches', async () => {
    const { net, handler } = placeStack(fakeFirestore())
    let ok = 0
    for (let i = 0; i < 60; i += 1) {
      if ((await call(handler, '203.0.113.66', { name: 'zz' + i.toString(36) })).code === 200) {
        ok += 1
      }
    }
    assert.equal(ok, 20)
    assert.equal(net.calls, 20)
    // Cached answers cost nothing and are still served.
    assert.equal((await call(handler, '203.0.113.66', { name: 'zz0' })).code, 200)
  })
})

describe('per-address limits across an IPv6 /48 (REVIEW4 M1)', () => {
  test('a /48 is one site with four times the per-address limit, not 65,536 budgets', async () => {
    // The probe: 65,536 addresses 2001:db8:1:<n>::1 were 65,536 separate keys.
    const handler = createApiHandler({
      name: 'forecast',
      method: 'GET',
      allowedOrigin: () => ORIGIN,
      appCheck: () => ({ verifyToken: async () => ({}) }),
      appCheckMode: 'standard',
      perAddressPerMinute: 60,
      fallbackMessage: 'Forecast unavailable',
      handler: async () => ({ body: { ok: true } }),
    })
    let allowed = 0
    for (let n = 0; n < 65536; n += 1) {
      if ((await call(handler, `2001:db8:1:${n.toString(16)}::1`, {})).code === 200) allowed += 1
    }
    assert.equal(allowed, 240)
    // Another site is unaffected.
    assert.equal((await call(handler, '2001:db8:2::1', {})).code, 200)
  })

  test('keys IPv6 clients by /64 and /48, IPv4 and mapped addresses by the address', () => {
    assert.deepEqual(addressScopes('2001:db8:1:2::9'), [
      { key: '2001:db8:1:2::/64', weight: 1 },
      { key: '2001:db8:1::/48', weight: 4 },
    ])
    assert.deepEqual(addressScopes('203.0.113.9'), [{ key: '203.0.113.9', weight: 1 }])
    assert.deepEqual(addressScopes('::ffff:203.0.113.9'), [{ key: '203.0.113.9', weight: 1 }])
    assert.deepEqual(clientScopes({ headers: {} }), [{ key: 'unknown', weight: 1 }])
  })

  test('a throttled client is never handed a fresh budget by eviction under pressure', () => {
    const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 60_000, maxKeys: 100 })
    for (let i = 0; i < 3; i += 1) limiter.take('attacker', 0)
    assert.equal(limiter.take('attacker', 1).allowed, false)
    // Fill the map with live windows: the throttled key is kept, and newcomers are
    // counted in the overflow sketch instead of refused (REVIEW5 M5).
    for (let i = 0; i < 1000; i += 1) limiter.take(`spray-${i}`, 2)
    assert.equal(limiter.windows.size, 100)
    assert.equal(limiter.take('attacker', 3).allowed, false)
    assert.equal(limiter.take('newcomer', 3).allowed, true)
    assert.equal(limiter.take('newcomer', 4).allowed, true)
    assert.equal(limiter.take('newcomer', 5).allowed, false)
    // Once windows expire, they make room again.
    assert.equal(limiter.take('newcomer', 60_002).allowed, true)
    assert.equal(limiter.windows.size, 1)
  })
})

describe('free-API forecasts stay out of the paid cache (REVIEW4 L7)', () => {
  const place = { lat: 34.05, lon: -118.24 }

  function feedCache(db, net) {
    // The feed with billing off and no key yet: Open-Meteo's free API.
    return new ForecastCache({
      db,
      provider: () => feedForecastProvider(false, 'unset'),
      upstreamAllowed: async () => true,
      now: () => T0,
      fetchImpl: net.fetchImpl,
    })
  }

  function proxyCache(db, provider = () => null) {
    return new ForecastCache({
      db,
      provider,
      upstreamAllowed: async () => true,
      now: () => T0,
      fetchImpl: upstream().fetchImpl,
    })
  }

  test('the proxy never serves what the feed fetched from the free API', async () => {
    const db = fakeFirestore()
    const net = upstream()
    const feed = feedCache(db, net)
    assert.equal(feedForecastProvider(false, 'unset'), openMeteoFree)
    assert.ok(await feed.get(place))
    assert.equal(net.calls, 1)
    // Nothing went to the shared cache, and the feed's own instance still has it.
    assert.equal([...db.docs.keys()].filter(id => id.startsWith('forecastCache/')).length, 0)
    assert.ok(await feed.get(place))
    assert.equal(net.calls, 1)
    // The proxy switched on before the key is set has nothing to serve.
    await assert.rejects(proxyCache(db).get(place), { code: 'unavailable' })
  })

  test('free or untagged entries in Firestore serve only a free-API cache', async () => {
    for (const source of [openMeteoFree.name, undefined]) {
      const db = fakeFirestore()
      db.docs.set('forecastCache/34.06_-118.24', {
        hour: '2026-10-27T14',
        fetchedAt: new Date(T0),
        payload: JSON.stringify(body()),
        ...(source ? { source } : {}),
      })
      await assert.rejects(proxyCache(db).get(place), { code: 'unavailable' }, String(source))
      // A commercial cache fetches its own copy instead, and tags it.
      const net = upstream()
      const paid = new ForecastCache({
        db,
        provider: () => commercialProvider('k'),
        upstreamAllowed: async () => true,
        now: () => T0,
        fetchImpl: net.fetchImpl,
      })
      assert.ok(await paid.get(place))
      assert.equal(net.calls, 1)
      assert.equal(db.docs.get('forecastCache/34.06_-118.24').source, 'open-meteo-commercial')
      // Which the proxy may serve, and the free-API feed may read too.
      assert.ok(await proxyCache(db).get(place))
      const feedNet = upstream()
      assert.ok(await feedCache(db, feedNet).get(place))
      assert.equal(feedNet.calls, 0)
    }
  })
})
