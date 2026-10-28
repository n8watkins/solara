import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchForecast, weatherLabel } from '@/lib/forecast'

/* eslint-disable @typescript-eslint/no-require-imports */
const core = require('../functions/core')
const sun = require('../functions/lib/feed/sun')
const { ForecastCache } = require('../functions/lib/forecast/proxy')
const { forecastHandler } = require('../functions/lib/forecast/endpoints')
// The Functions log through firebase-functions/logger, resolved from functions/.
const { logger } = createRequire(require.resolve('../functions/package.json'))(
  'firebase-functions/logger',
)
/* eslint-enable @typescript-eslint/no-require-imports */

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function failing(status = 503) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

function rawDay(date: string, uv = 1) {
  const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`)
  return {
    timezone: 'UTC',
    hourly: {
      time,
      uv_index: time.map(() => uv),
      temperature_2m: time.map(() => 20),
      weathercode: time.map(() => 0),
    },
  }
}

/** A fetch that never settles until its signal aborts, like a hung provider. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('weather labels', () => {
  it('uses one table in the app and the Functions', () => {
    for (let code = -1; code <= 100; code++) {
      expect(core.weatherLabel(code)).toBe(weatherLabel(code))
    }
  })

  it('maps WMO groups, including snow showers, and marks missing codes as unknown', () => {
    expect(weatherLabel(45)).toBe('Foggy')
    expect(weatherLabel(71)).toBe('Snowy')
    expect(weatherLabel(80)).toBe('Showers')
    expect(weatherLabel(86)).toBe('Snowy')
    expect(weatherLabel(99)).toBe('Stormy')
    expect(weatherLabel(null)).toBe('Unknown')
    expect(weatherLabel(Number.NaN)).toBe('Unknown')
    expect(weatherLabel(150)).toBe('Unknown')
  })
})

describe('parseHourlyRows', () => {
  it('keeps unknown values as null instead of 0', () => {
    const rows = core.parseHourlyRows({
      hourly: {
        time: ['2026-06-15T10:00', 'garbage', '2026-06-15T11:00'],
        uv_index: [null, 1, 2.26],
        temperature_2m: [null, 20, 20],
        weathercode: [null, 0, 0],
      },
    })
    expect(rows).toEqual([
      {
        date: '2026-06-15',
        hour: 10,
        uv: null,
        clearSkyUV: null,
        tempF: null,
        weatherCode: null,
        cloudCover: null,
      },
      {
        date: '2026-06-15',
        hour: 11,
        uv: 2.3,
        clearSkyUV: null,
        tempF: 68,
        weatherCode: 0,
        cloudCover: null,
      },
    ])
  })

  it('rejects a response without an hourly time series', () => {
    expect(() => core.parseHourlyRows({})).toThrow(/incomplete/)
    expect(() => core.parseHourlyRows({ hourly: { time: 'x' } })).toThrow(/incomplete/)
  })
})

describe('fetchJson', () => {
  it('times out a hung request', async () => {
    vi.useFakeTimers()
    const fetchImpl = hangingFetch()
    const pending = core.fetchJson('https://example.test', { fetchImpl, timeoutMs: 5000 })
    const assertion = expect(pending).rejects.toThrow('timed out after 5000 ms')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it("passes on the caller's abort", async () => {
    const controller = new AbortController()
    const pending = core.fetchJson('https://example.test', {
      fetchImpl: hangingFetch(),
      signal: controller.signal,
    })
    controller.abort(new Error('caller aborted'))
    await expect(pending).rejects.toThrow('caller aborted')
  })

  it('rejects a non-2xx status', async () => {
    await expect(
      core.fetchJson('https://example.test', { fetchImpl: async () => failing(429) }),
    ).rejects.toThrow('Forecast request failed: 429')
  })
})

describe('app fetchForecast', () => {
  it('gives up after 5 s by default', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const pending = fetchForecast({ lat: 34, lon: -118, city: 'LA', region: 'CA' })
    const assertion = expect(pending).rejects.toThrow('timed out after 5000 ms')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })
})

describe('calendar feed forecast', () => {
  /** The shared forecast cache the feed reads through, over an in-memory Firestore. */
  function feedForecasts(fetchImpl: () => Promise<Response>, now: () => number) {
    const docs = new Map<string, unknown>()
    const db = {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => ({ data: () => docs.get(id) }),
          set: async (data: unknown) => docs.set(id, data),
        }),
      }),
    }
    return new ForecastCache({
      db,
      provider: () => core.openMeteoFree,
      upstreamAllowed: async () => true,
      now,
      fetchImpl: (...args: unknown[]) =>
        (fetchImpl as (...a: unknown[]) => Promise<Response>)(...args),
    })
  }

  it('serves the last good forecast when the provider fails', async () => {
    const t0 = Date.parse('2026-06-15T12:00:00Z')
    let now = t0
    let respond = async () => okJson(rawDay('2026-06-15'))
    const cache = feedForecasts(
      () => respond(),
      () => now,
    )
    const good = sun.parseSunForecast(await cache.get({ lat: 34, lon: -118 }), 1)
    vi.spyOn(logger, 'warn').mockImplementation(() => {})

    respond = async () => failing()
    now = t0 + 60 * 60 * 1000
    const fallback = sun.parseSunForecast(await cache.get({ lat: 34, lon: -118 }), 1)
    expect(fallback).toEqual(good)
  })

  it('does not share a last good forecast between places', async () => {
    let respond = async () => okJson(rawDay('2026-06-15'))
    const cache = feedForecasts(
      () => respond(),
      () => Date.parse('2026-06-15T12:00:00Z'),
    )
    await cache.get({ lat: 34, lon: -118 })
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    respond = async () => failing()
    await expect(cache.get({ lat: 40, lon: -74 })).rejects.toThrow('Forecast unavailable')
  })
})

describe("the forecast proxy's earlier copy in the app", () => {
  it('keeps its real age and the stale flag, and nothing changes for a fresh answer', async () => {
    const t0 = Date.parse('2026-06-15T16:40:00Z')
    let now = t0
    const docs = new Map<string, unknown>()
    const db = {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => ({ data: () => docs.get(id) }),
          set: async (data: unknown) => docs.set(id, data),
        }),
      }),
    }
    const cache = new ForecastCache({
      db,
      provider: () => core.openMeteoCommercial('key'),
      upstreamAllowed: async () => true,
      now: () => now,
      fetchImpl: async () => okJson(rawDay('2026-06-15', 4)),
    })
    let shareLeft = true
    const handler = forecastHandler({
      enabled: () => true,
      cache,
      share: { take: async () => shareLeft },
    })
    const answer = async () =>
      (
        await handler({
          headers: { 'x-forwarded-for': '198.51.100.7' },
          socket: {},
          query: { lat: '34.05', lon: '-118.24' },
        })
      ).body
    const place = { lat: 34.05, lon: -118.24, city: 'LA', region: 'CA', timezone: 'UTC' }

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(await answer())),
    )
    const fresh = await fetchForecast(place, { days: 1 })
    expect(fresh.fetchedAt).toBe(t0)
    expect('stale' in fresh).toBe(false)

    // Fifty minutes into the next hour the caller's share is spent: the proxy serves its copy.
    shareLeft = false
    now = t0 + 70 * 60_000
    vi.setSystemTime(now)
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    const earlier = await fetchForecast(place, { days: 1 })
    expect(earlier.stale).toBe(true)
    expect(earlier.fetchedAt).toBe(t0)
    expect(earlier.days).toEqual(fresh.days)
  })
})
