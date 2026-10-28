import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_KEY,
  CACHE_VERSION,
  MAX_AGE_MS,
  MAX_ENTRIES,
  clearWeatherCache,
  getCachedForecast,
  locationKey,
  setCachedForecast,
} from '@/lib/cache'
import type { ForecastData } from '@/lib/types'

const NOW = Date.parse('2026-06-15T17:30:00Z')

function forecast(overrides: Partial<ForecastData> = {}): ForecastData {
  return {
    timezone: 'America/Los_Angeles',
    fetchedAt: NOW,
    current: { uv: 6.2, tempC: 24.5, condition: 'Clear' },
    days: [
      {
        dateStr: '2026-06-15',
        hourly: [{ date: '2026-06-15', hour: 10, uv: 6.2, tempC: 24.5, condition: 'Clear' }],
      },
    ],
    ...overrides,
  }
}

const storage = new Map<string, string>()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('forecast cache', () => {
  it('keeps one entry per location and returns stale entries for revalidation', () => {
    setCachedForecast(34.05, -118.24, forecast())
    setCachedForecast(51.5, -0.12, forecast({ timezone: 'Europe/London' }))
    expect(getCachedForecast(34.05, -118.24)?.timezone).toBe('America/Los_Angeles')
    expect(getCachedForecast(51.5, -0.12)?.timezone).toBe('Europe/London')
    // Coordinates are matched after the same rounding requests use.
    expect(getCachedForecast(34.051, -118.244)).not.toBeNull()
    expect(getCachedForecast(40, -74)).toBeNull()
    // A few hours old is still served (the query layer refreshes it).
    expect(getCachedForecast(34.05, -118.24, NOW + 5 * 3_600_000)).not.toBeNull()
  })

  it("keeps the stale flag of the proxy's earlier copy, and adds none to a fresh one", () => {
    setCachedForecast(34.05, -118.24, forecast({ stale: true, fetchedAt: NOW - 3_600_000 }))
    setCachedForecast(51.5, -0.12, forecast({ timezone: 'Europe/London' }))
    expect(getCachedForecast(34.05, -118.24)).toMatchObject({
      stale: true,
      fetchedAt: NOW - 3_600_000,
    })
    expect(getCachedForecast(51.5, -0.12)).toEqual(forecast({ timezone: 'Europe/London' }))
  })

  it('drops entries past the maximum age', () => {
    setCachedForecast(34.05, -118.24, forecast())
    expect(getCachedForecast(34.05, -118.24, NOW + MAX_AGE_MS + 1)).toBeNull()
  })

  it('evicts the least recently fetched location beyond the limit', () => {
    for (let i = 0; i <= MAX_ENTRIES; i++) {
      setCachedForecast(10 + i, 10, forecast({ fetchedAt: NOW - (MAX_ENTRIES - i) * 1000 }))
    }
    expect(getCachedForecast(10, 10)).toBeNull()
    expect(getCachedForecast(11, 10)).not.toBeNull()
    expect(getCachedForecast(10 + MAX_ENTRIES, 10)).not.toBeNull()
  })

  it('rejects a store from another version', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION - 1,
        entries: [{ key: locationKey(34.05, -118.24), data: forecast() }],
      }),
    )
    expect(getCachedForecast(34.05, -118.24)).toBeNull()
  })

  it('drops malformed entries but keeps valid ones', () => {
    const bad = [
      { key: locationKey(1, 1), data: { ...forecast(), timezone: 'Not/AZone' } },
      { key: locationKey(2, 2), data: { ...forecast(), current: { uv: 'high' } } },
      { key: locationKey(3, 3), data: { ...forecast(), days: [{ dateStr: '2026-02-30' }] } },
      { key: locationKey(4, 4), data: forecast({ fetchedAt: Number.NaN }) },
      'garbage',
    ]
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        entries: [...bad, { key: locationKey(34.05, -118.24), data: forecast() }],
      }),
    )
    for (const n of [1, 2, 3, 4]) expect(getCachedForecast(n, n)).toBeNull()
    expect(getCachedForecast(34.05, -118.24)).toEqual(forecast())
  })

  it('survives unparseable storage and removes the legacy cache', () => {
    localStorage.setItem(CACHE_KEY, '{not json')
    localStorage.setItem('solara_weather', JSON.stringify({ data: {}, lat: 1, lon: 1, ts: NOW }))
    expect(getCachedForecast(1, 1)).toBeNull()
    expect(localStorage.getItem('solara_weather')).toBeNull()
  })

  it('clears everything', () => {
    setCachedForecast(34.05, -118.24, forecast())
    clearWeatherCache()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(getCachedForecast(34.05, -118.24)).toBeNull()
  })
})
