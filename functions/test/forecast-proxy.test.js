// The forecast proxy: the provider adapters behind the shared parser, request
// validation, the per-place-and-hour cache, coalescing, the timeout and the last-good
// fallback, and the cost guard.
const { beforeEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const core = require('../core/index.js')
const { commercialProvider } = require('../lib/forecast/config')
const {
  ForecastCache,
  LAST_GOOD_MAX_AGE_MS,
  forecastHour,
  placeKey,
  requestedPlace,
} = require('../lib/forecast/proxy')
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

function cache(db, net, { now, provider = commercialProvider('key-123'), allowed = true } = {}) {
  return new ForecastCache({
    db,
    provider: () => provider,
    upstreamAllowed: async () => allowed,
    now: () => now.value,
    fetchImpl: net.fetchImpl,
  })
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
      'uv_index,temperature_2m,weathercode,cloudcover',
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
  test('rounds the place to the 0.01 degree cache grid and refuses anything else', () => {
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
    const stored = db.docs.get('34.05_-118.24')
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

  test('without a commercial key, never calls upstream', async () => {
    const net = upstream()
    await assert.rejects(cache(fakeDb(), net, { now, provider: null }).get(place), {
      code: 'unavailable',
    })
    assert.equal(net.calls.length, 0)
  })
})
