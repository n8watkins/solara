import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedForecast } from '@/lib/cache'
import { createForecastStore } from '@/lib/use-forecast'
import type { ForecastData, Location } from '@/lib/types'

// The app's forecast store (lib/use-forecast.ts createForecastStore) with the forecast
// proxy answering its earlier copy (`stale` with `fetchedAt`).

const NOW = Date.parse('2026-06-15T17:30:00Z')
const place: Location = { lat: 34.05, lon: -118.24, city: 'LA', region: 'CA', timezone: 'UTC' }

function raw(extra: Record<string, unknown> = {}) {
  const time = Array.from({ length: 24 }, (_, h) => `2026-06-15T${String(h).padStart(2, '0')}:00`)
  return {
    timezone: 'UTC',
    current: { uv_index: 5, temperature_2m: 20, weathercode: 0 },
    hourly: {
      time,
      uv_index: time.map(() => 5),
      temperature_2m: time.map(() => 20),
      weathercode: time.map(() => 0),
    },
    ...extra,
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

/** Loads `place` through a new store answering `body`, and returns what it shows. */
async function load(body: unknown): Promise<ForecastData | undefined> {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)))
  const store = createForecastStore()
  store.refetch(place)
  await vi.waitFor(() => expect(store.getState(place).updatedAt).not.toBe(0))
  return store.getState(place).data
}

describe("the forecast store and the proxy's earlier copy", () => {
  it('shows and keeps the earlier copy with its real age', async () => {
    const fetchedAt = NOW - 2 * 3_600_000
    const shown = await load(raw({ stale: true, fetchedAt: new Date(fetchedAt).toISOString() }))
    expect(shown).toMatchObject({ stale: true, fetchedAt })
    expect(getCachedForecast(place.lat, place.lon)).toMatchObject({ stale: true, fetchedAt })
  })

  it('never replaces a newer forecast with an earlier copy', async () => {
    const newer = (await load(raw()))!
    vi.setSystemTime(NOW + 3_600_000)
    const earlier = new Date(NOW - 3_600_000).toISOString()
    const shown = await load(raw({ stale: true, fetchedAt: earlier }))
    expect(shown).toEqual(newer)
    expect(getCachedForecast(place.lat, place.lon)).toEqual(newer)
  })

  it('stores a fresh forecast without a stale flag', async () => {
    const shown = await load(raw())
    expect(shown && 'stale' in shown).toBe(false)
    expect(getCachedForecast(place.lat, place.lon)).toEqual(shown)
  })
})
