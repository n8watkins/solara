// The forecast proxy: the provider adapters behind the shared parser, request
// validation, the per-place-and-hour cache, coalescing, the timeout and the last-good
// fallback, and the cost guard.
const { beforeEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const core = require('../core/index.js')
const { commercialProvider } = require('../lib/forecast/config')
const {
  FALLBACK_RETRY_MS,
  ForecastCache,
  LAST_GOOD_MAX_AGE_MS,
  forecastHour,
  gridPlace,
  placeKey,
  requestedPlace,
} = require('../lib/forecast/proxy')
const { UpstreamBudget } = require('../lib/forecast/upstream-budget')
const { PlaceSearchCache, requestedSearch } = require('../lib/forecast/place-search')
const { captureLogs } = require('./support/logs')

const logs = captureLogs()
const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-10-27T14:05:00Z')

function openMeteoBody(uv = 3) {
  return {
    timezone: 'America/Los_Angeles',
    current: { time: '2026-10-27T07:00', uv_index: uv, temperature_2m: 18, weathercode: 1 },
    hourly: {
      time: ['2026-10-27T07:00', '2026-10-27T08:00'],
      uv_index: [uv, uv + 1],
      temperature_2m: [18, 19],
      weathercode: [1, 1],
      cloudcover: [10, 20],
    },
  }
}

/** A Firestore stand-in with one collection, shared like real Firestore between "instances". */
function fakeDb() {
  const docs = new Map()
  const db = {
    docs,
    reads: 0,
    writes: 0,
    collection(name) {
      assert.equal(name, 'forecastCache')
      return {
        doc: id => ({
          get: async () => {
            db.reads += 1
            return { data: () => docs.get(id) }
          },
          set: async data => {
            db.writes += 1
            docs.set(id, data)
          },
        }),
      }
    },
  }
  return db
}

function upstream() {
  const calls = []
  let respond = () => ({ ok: true, json: async () => openMeteoBody() })
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { calls, fetchImpl, respondWith: fn => (respond = fn) }
}

function cache(
  db,
  net,
  { now, provider = commercialProvider('key-123'), allowed = true, upstreamBudget } = {},
) {
  return new ForecastCache({
    db,
    provider: () => provider,
    upstreamAllowed: async () => allowed,
    upstreamBudget,
    now: () => now.value,
    fetchImpl: net.fetchImpl,
  })
}

/** A budget stand-in that allows `left` calls in all. */
function budget(left) {
  const state = { left, asked: 0 }
  return {
    state,
    take: async () => {
      state.asked += 1
      if (state.left <= 0) return false
      state.left -= 1
      return true
    },
  }
}

describe('forecast providers', () => {
  const request = core.appForecastRequest(34.05, -118.24)

  test('the free API is the direct one, and the commercial one adds the key', () => {
    assert.match(core.openMeteoFree.request(request).url, /^https:\/\/api\.open-meteo\.com\//)
    const commercial = new URL(commercialProvider('a key/with?chars').request(request).url)
    assert.equal(commercial.origin, 'https://customer-api.open-meteo.com')
    assert.equal(commercial.pathname, '/v1/forecast')
    // The key is URL-encoded, so no character in it can change the request.
    assert.equal(commercial.searchParams.get('apikey'), 'a key/with?chars')
    assert.equal(commercial.searchParams.get('latitude'), '34.05')
    assert.equal(commercial.searchParams.get('forecast_days'), '10')
    assert.equal(
      commercial.searchParams.get('hourly'),
      'uv_index,uv_index_clear_sky,temperature_2m,weathercode,cloudcover,' +
        'precipitation_probability,apparent_temperature',
    )
    assert.equal(commercialProvider('unset'), null)
    assert.equal(commercialProvider('  '), null)
  })

  test('the proxy adapter sends only the coordinates and the App Check token', () => {
    const proxy = core.solaraForecastProxy('https://fn.example.com/project/us-central1/', 'tok')
    assert.deepEqual(proxy.request(request), {
      url: 'https://fn.example.com/project/us-central1/forecast?lat=34.05&lon=-118.24',
      headers: { 'X-Firebase-AppCheck': 'tok' },
    })
  })

  test('every provider goes through the validated parser', async () => {
    const net = upstream()
    net.respondWith(() => ({ ok: true, json: async () => ({ hourly: {} }) }))
    await assert.rejects(
      core.fetchProviderForecast(core.openMeteoFree, request, { fetchImpl: net.fetchImpl }),
      /incomplete/,
    )
  })
})

describe('forecast proxy requests', () => {
  test('rounds the place to 0.01 degree and refuses anything else', () => {
    assert.deepEqual(requestedPlace({ lat: '34.0522', lon: '-118.2437' }), {
      lat: 34.05,
      lon: -118.24,
    })
    assert.equal(placeKey({ lat: 34.05, lon: -118.24 }), '34.05_-118.24')
    for (const query of [
      {},
      { lat: '34', lon: 'x' },
      { lat: '91', lon: '0' },
      { lat: '0', lon: '181' },
      { lat: '1e3', lon: '0' },
      { lat: ['1', '2'], lon: '0' },
      { lat: '0'.repeat(20), lon: '0' },
    ]) {
      assert.throws(
        () => requestedPlace(query),
        { code: 'invalid-argument' },
        JSON.stringify(query),
      )
    }
  })

  test('snaps places to the 0.02 degree cache grid', () => {
    assert.deepEqual(gridPlace({ lat: 34.05, lon: -118.24 }), { lat: 34.06, lon: -118.24 })
    assert.deepEqual(gridPlace({ lat: 34.031, lon: -118.269 }), { lat: 34.04, lon: -118.26 })
    assert.deepEqual(gridPlace({ lat: -0.03, lon: 179.99 }), { lat: -0.02, lon: 180 })
    assert.equal(placeKey(gridPlace({ lat: -0.01, lon: 0 })), '0.00_0.00')
    assert.deepEqual(gridPlace({ lat: 90, lon: -180 }), { lat: 90, lon: -180 })
    // Four 0.01 degree points share one cell.
    const keys = new Set(
      [
        [34.05, -118.25],
        [34.06, -118.25],
        [34.05, -118.24],
        [34.06, -118.24],
      ].map(([lat, lon]) => placeKey(gridPlace({ lat, lon }))),
    )
    assert.equal(keys.size, 1)
  })

  test('buckets forecasts by UTC hour', () => {
    assert.equal(forecastHour(T0), '2026-10-27T14')
    assert.equal(forecastHour(T0 + HOUR), '2026-10-27T15')
  })
})

describe('forecast proxy cache', () => {
  const place = { lat: 34.05, lon: -118.24 }
  let now
  beforeEach(() => {
    now = { value: T0 }
  })

  test('fetches a place once an hour and shares it across instances', async () => {
    const db = fakeDb()
    const net = upstream()
    const first = cache(db, net, { now })
    const second = cache(db, net, { now })

    assert.deepEqual(await first.get(place), core.parseOpenMeteoResponse(openMeteoBody()))
    await first.get(place)
    // Another instance reads the shared copy instead of calling upstream.
    await second.get(place)
    assert.equal(net.calls.length, 1)
    assert.match(net.calls[0].url, /customer-api\.open-meteo\.com.*apikey=key-123/)
    const stored = db.docs.get('34.06_-118.24')
    assert.equal(stored.hour, '2026-10-27T14')
    assert.equal(stored.expireAt.getTime(), T0 + 24 * HOUR)

    // The next hour fetches again.
    now.value = T0 + HOUR
    await first.get(place)
    assert.equal(net.calls.length, 2)
  })

  test('shares one upstream call between concurrent requests', async () => {
    const net = upstream()
    let release
    net.respondWith(
      () =>
        new Promise(resolve => {
          release = () => resolve({ ok: true, json: async () => openMeteoBody() })
        }),
    )
    const proxy = cache(fakeDb(), net, { now })
    const all = Promise.all([proxy.get(place), proxy.get(place), proxy.get(place)])
    await new Promise(resolve => setImmediate(resolve))
    release()
    await all
    assert.equal(net.calls.length, 1)
  })

  test('serves the last good forecast when upstream fails, for up to six hours', async () => {
    const db = fakeDb()
    const net = upstream()
    const proxy = cache(db, net, { now })
    await proxy.get(place)

    net.respondWith(() => ({ ok: false, status: 503 }))
    now.value = T0 + 5 * HOUR
    assert.deepEqual(await proxy.get(place), core.parseOpenMeteoResponse(openMeteoBody()))
    assert.ok(
      logs.entries.some(entry => entry.message === 'forecast served from the last good copy'),
    )
    // No coordinates in any log.
    assert.doesNotMatch(JSON.stringify(logs.entries), /34\.05|118\.24/)

    now.value = T0 + LAST_GOOD_MAX_AGE_MS + 1
    await assert.rejects(proxy.get(place), { code: 'unavailable' })
  })

  test('remembers a fallback, so a flood costs no Firestore read or log line per request (L1)', async () => {
    // The review's probe F2: with the cost guard engaged in the next hour, 100 requests
    // read Firestore 100 times and logged 100 warnings.
    const db = fakeDb()
    const net = upstream()
    await cache(db, net, { now }).get(place)
    now.value = T0 + HOUR
    const guarded = cache(db, net, { now, allowed: false })
    const reads = db.reads
    for (let i = 0; i < 100; i += 1) assert.ok(await guarded.get(place))
    assert.equal(db.reads - reads, 1)
    assert.equal(
      logs.entries.filter(entry => entry.message === 'forecast served from the last good copy')
        .length,
      1,
    )
    // A few minutes later it looks again.
    now.value += FALLBACK_RETRY_MS
    await guarded.get(place)
    assert.equal(db.reads - reads, 2)
  })

  test('remembers a place with nothing to serve too', async () => {
    const db = fakeDb()
    const guarded = cache(db, upstream(), { now, allowed: false })
    for (let i = 0; i < 20; i += 1) {
      await assert.rejects(guarded.get(place), { code: 'unavailable' })
    }
    assert.equal(db.reads, 1)
    assert.equal(logs.entries.filter(entry => entry.message === 'forecast unavailable').length, 1)
  })

  test('times out a slow upstream and falls back', async () => {
    const db = fakeDb()
    const net = upstream()
    const proxy = cache(db, net, { now })
    await proxy.get(place)
    now.value = T0 + HOUR
    net.respondWith(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason)),
        ),
    )
    const started = Date.now()
    assert.ok(await proxy.get(place))
    assert.ok(Date.now() - started < 6000)
  })

  test('serves only cached forecasts while the cost guard is engaged', async () => {
    const db = fakeDb()
    const net = upstream()
    await cache(db, net, { now }).get(place)
    now.value = T0 + HOUR
    const guarded = cache(db, net, { now, allowed: false })
    assert.ok(await guarded.get(place))
    assert.equal(net.calls.length, 1)
    await assert.rejects(guarded.get({ lat: 1, lon: 1 }), { code: 'unavailable' })
    assert.equal(net.calls.length, 1)
  })

  test('stops calling upstream when the global budget is spent (M1)', async () => {
    // The review's probe F1: 500 distinct places made 500 upstream calls and 500 writes.
    const db = fakeDb()
    const net = upstream()
    const spend = budget(100)
    const proxy = cache(db, net, { now, upstreamBudget: spend })
    let unavailable = 0
    for (let i = 0; i < 500; i += 1) {
      try {
        await proxy.get(requestedPlace({ lat: (10 + i / 10).toFixed(2), lon: '20' }))
      } catch (error) {
        assert.equal(error.code, 'unavailable')
        unavailable += 1
      }
    }
    assert.equal(net.calls.length, 100)
    assert.equal(db.writes, 100)
    assert.equal(unavailable, 400)
    // A place cached before the budget ran out is still served.
    assert.ok(await proxy.get(requestedPlace({ lat: '10.00', lon: '20' })))
  })

  test("asks the caller's own limit only on a miss, and before the global budget", async () => {
    const db = fakeDb()
    const net = upstream()
    const spend = budget(10)
    const proxy = cache(db, net, { now, upstreamBudget: spend })
    let asked = 0
    const mayFetch = () => {
      asked += 1
      return asked <= 1
    }
    await proxy.get(place, { mayFetch })
    await proxy.get(place, { mayFetch })
    assert.equal(asked, 1)
    await assert.rejects(proxy.get({ lat: 1, lon: 1 }, { mayFetch }), { code: 'unavailable' })
    assert.equal(asked, 2)
    assert.equal(spend.state.asked, 1)
    // A refusal by one caller's limit is not remembered for other callers.
    assert.ok(await proxy.get({ lat: 1, lon: 1 }))
    assert.equal(net.calls.length, 2)
  })

  test('without a commercial key, never calls upstream', async () => {
    const net = upstream()
    await assert.rejects(cache(fakeDb(), net, { now, provider: null }).get(place), {
      code: 'unavailable',
    })
    assert.equal(net.calls.length, 0)
  })
})

describe('forecast upstream budget', () => {
  /** A Firestore stand-in with transactions, enough for UpstreamBudget. */
  function counterDb({ fail = false } = {}) {
    const docs = new Map()
    const db = {
      docs,
      transactions: 0,
      collection(name) {
        assert.equal(name, 'forecastUpstream')
        return { doc: id => ({ id }) }
      },
      async runTransaction(work) {
        db.transactions += 1
        if (fail) throw new Error('Firestore unavailable')
        const writes = []
        const result = await work({
          getAll: async (...refs) => refs.map(ref => ({ data: () => docs.get(ref.id) })),
          set: (ref, data) => writes.push([ref.id, data]),
        })
        for (const [id, data] of writes) docs.set(id, data)
        return result
      },
    }
    return db
  }

  test('leases calls in blocks and stops at the hourly and daily caps', async () => {
    let now = Date.parse('2026-10-27T14:05:00Z')
    const db = counterDb()
    const spend = new UpstreamBudget({
      db,
      limits: () => ({ perHour: 25, perDay: 40 }),
      leaseSize: 10,
      now: () => now,
    })
    let granted = 0
    for (let i = 0; i < 30; i += 1) if (await spend.take()) granted += 1
    assert.equal(granted, 25)
    assert.equal(db.docs.get('hour-2026-10-27T14').count, 25)
    assert.equal(db.docs.get('day-2026-10-27').count, 25)
    // Three leases for 25 calls, then one look that found the hour spent.
    assert.equal(db.transactions, 4)
    assert.equal(
      logs.entries.filter(e => e.message === 'forecast upstream budget exhausted').length,
      1,
    )
    // Spent: no further Firestore transaction for a minute.
    await spend.take()
    assert.equal(db.transactions, 4)

    // The next hour has its own budget, until the day's runs out.
    now += 60 * 60 * 1000
    granted = 0
    for (let i = 0; i < 30; i += 1) if (await spend.take()) granted += 1
    assert.equal(granted, 15)
    assert.equal(db.docs.get('day-2026-10-27').count, 40)
    assert.ok(db.docs.get('hour-2026-10-27T15').expireAt instanceof Date)
  })

  test('two instances share one budget', async () => {
    const now = Date.parse('2026-10-27T14:05:00Z')
    const db = counterDb()
    const make = () =>
      new UpstreamBudget({ db, limits: () => ({ perHour: 20, perDay: 100 }), now: () => now })
    const [a, b] = [make(), make()]
    let granted = 0
    for (let i = 0; i < 30; i += 1) {
      if (await a.take()) granted += 1
      if (await b.take()) granted += 1
    }
    assert.equal(granted, 20)
  })

  test('fails closed when the counters cannot be read', async () => {
    const spend = new UpstreamBudget({
      db: counterDb({ fail: true }),
      limits: () => ({ perHour: 100, perDay: 100 }),
    })
    assert.equal(await spend.take(), false)
    assert.ok(logs.entries.some(e => e.message === 'forecast upstream budget could not be read'))
  })
})

describe('place search proxy (L3)', () => {
  const PASADENA = {
    latitude: 34.1478,
    longitude: -118.1445,
    name: 'Pasadena',
    admin1: 'California',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    population: 141029,
  }

  function places({ key = 'key-123', allowed = true, left = 100, respond } = {}) {
    const calls = []
    const spend = { left, take: async () => spend.left-- > 0 }
    const search = new PlaceSearchCache({
      apiKey: () => key,
      upstreamAllowed: async () => allowed,
      upstreamBudget: spend,
      fetchImpl: async (url, init) => {
        calls.push({ url: new URL(url), init })
        return respond ? respond() : { ok: true, json: async () => ({ results: [PASADENA] }) }
      },
    })
    return { calls, search }
  }

  test('accepts only a short place name and a small count', () => {
    assert.deepEqual(requestedSearch({ name: '  Pasadena,   CA ', count: '10' }), {
      name: 'Pasadena, CA',
      count: 10,
    })
    assert.deepEqual(requestedSearch({ name: 'Pa' }), { name: 'Pa', count: 5 })
    for (const query of [
      {},
      { name: 'P' },
      { name: 'x'.repeat(81) },
      { name: 'Pasadena\u0000' },
      { name: ['a', 'b'] },
      { name: 'Pasadena', count: '0' },
      { name: 'Pasadena', count: '11' },
      { name: 'Pasadena', count: '5.5' },
      { name: 'Pasadena', count: '100' },
    ]) {
      assert.throws(
        () => requestedSearch(query),
        { code: 'invalid-argument' },
        JSON.stringify(query),
      )
    }
  })

  test('asks the commercial host with the key, returns only validated fields, and caches', async () => {
    const { calls, search } = places()
    const first = await search.search({ name: 'Pasadena', count: 5 })
    // `population` and anything else Open-Meteo sends is dropped.
    assert.deepEqual(first, {
      results: [
        {
          latitude: 34.1478,
          longitude: -118.1445,
          name: 'Pasadena',
          admin1: 'California',
          country: 'United States',
          timezone: 'America/Los_Angeles',
        },
      ],
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.origin, 'https://customer-geocoding-api.open-meteo.com')
    assert.equal(calls[0].url.searchParams.get('apikey'), 'key-123')
    assert.equal(calls[0].url.searchParams.get('name'), 'Pasadena')
    assert.equal(calls[0].url.searchParams.get('count'), '5')
    // The same search, in any case, is served from memory.
    await search.search({ name: 'pasadena', count: 5 })
    assert.equal(calls.length, 1)
  })

  test('never calls upstream without a key, under the cost guard, or past the budget', async () => {
    for (const setup of [{ key: null }, { allowed: false }, { left: 0 }]) {
      const { calls, search } = places(setup)
      await assert.rejects(search.search({ name: 'Pasadena', count: 5 }), { code: 'unavailable' })
      assert.equal(calls.length, 0, JSON.stringify(setup))
    }
  })

  test('turns an upstream failure into 503 without leaking the key', async () => {
    const { search } = places({ respond: () => ({ ok: false, status: 500 }) })
    await assert.rejects(search.search({ name: 'Pasadena', count: 5 }), { code: 'unavailable' })
    assert.doesNotMatch(JSON.stringify(logs.entries), /key-123/)
  })
})
