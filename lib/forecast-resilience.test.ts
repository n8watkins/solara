import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchForecast, weatherLabel } from '@/lib/forecast'

/* eslint-disable @typescript-eslint/no-require-imports */
const core = require('../functions/lib/forecast-core')
const sun = require('../functions/lib/sun')
const notificationCore = require('../scripts/notification-core')
const { clearForecastCache, fetchHourly } = require('../scripts/send-notifications')
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
  sun.clearLastGoodForecasts()
  clearForecastCache()
})

describe('weather labels', () => {
  it('uses one table in the app and the notifier', () => {
    for (let code = -1; code <= 100; code++) {
      expect(notificationCore.weatherLabel(code)).toBe(weatherLabel(code))
    }
    expect(notificationCore.weatherLabel).toBe(core.weatherLabel)
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
        tempF: null,
        weatherCode: null,
        cloudCover: null,
      },
      { date: '2026-06-15', hour: 11, uv: 2.3, tempF: 68, weatherCode: 0, cloudCover: null },
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
  it('serves the last good forecast when the provider fails', async () => {
    const t0 = Date.parse('2026-06-15T12:00:00Z')
    const good = await sun.fetchForecast(34, -118, 1, {
      fetchImpl: async () => okJson(rawDay('2026-06-15')),
      now: t0,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fallback = await sun.fetchForecast(34, -118, 1, {
      fetchImpl: async () => failing(),
      now: t0 + sun.LAST_GOOD_MAX_AGE_MS,
    })
    expect(fallback).toEqual(good)

    await expect(
      sun.fetchForecast(34, -118, 1, {
        fetchImpl: async () => failing(),
        now: t0 + sun.LAST_GOOD_MAX_AGE_MS + 1,
      }),
    ).rejects.toThrow('Forecast request failed: 503')
  })

  it('does not share a last good forecast between places', async () => {
    await sun.fetchForecast(34, -118, 1, { fetchImpl: async () => okJson(rawDay('2026-06-15')) })
    await expect(
      sun.fetchForecast(40, -74, 1, { fetchImpl: async () => failing() }),
    ).rejects.toThrow('Forecast request failed: 503')
  })
})

describe('notifier forecast cache', () => {
  it('retries a failed request once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(failing())
      .mockResolvedValueOnce(okJson(rawDay('2026-06-15')))
    const forecast = await fetchHourly(34, -118, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(forecast.hourly).toHaveLength(15)
  })

  it('evicts a failed lookup so a later subscriber tries again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    const down = vi.fn(async () => failing())
    await expect(fetchHourly(34, -118, { fetchImpl: down })).rejects.toThrow('503')
    expect(down).toHaveBeenCalledTimes(2)

    const up = vi.fn(async () => okJson(rawDay('2026-06-15')))
    const forecast = await fetchHourly(34, -118, { fetchImpl: up })
    expect(up).toHaveBeenCalledTimes(1)
    expect(forecast.timezone).toBe('UTC')

    // A success stays cached for the rest of the run.
    await fetchHourly(34, -118, { fetchImpl: up })
    expect(up).toHaveBeenCalledTimes(1)
  })
})
