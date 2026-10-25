import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForecastStore, type ForecastStoreOptions } from './forecast-store'
import type { ForecastData, Location } from './types'

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' }
const SD: Location = { lat: 32.72, lon: -117.16, city: 'San Diego', region: 'California' }
const STALE_MS = 30 * 60 * 1000
const T0 = Date.UTC(2026, 5, 15, 17)

function forecast(fetchedAt: number, uv = 5): ForecastData {
  return {
    timezone: 'America/Los_Angeles',
    fetchedAt,
    current: { uv, tempC: 20, condition: 'Clear' },
    days: [],
  }
}

/** A fetch that the test answers by hand, one request at a time. */
function controlledFetch() {
  const calls: {
    location: Location
    signal: AbortSignal
    resolve: (data: ForecastData) => void
    reject: (error: unknown) => void
  }[] = []
  const fetchForecast = vi.fn(
    (location: Location, signal: AbortSignal) =>
      new Promise<ForecastData>((resolve, reject) => {
        calls.push({ location, signal, resolve, reject })
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
  return { calls, fetchForecast }
}

function store(overrides: Partial<ForecastStoreOptions> = {}) {
  return new ForecastStore({
    fetchForecast: () => Promise.reject(new Error('unexpected fetch')),
    readCache: () => null,
    keyOf: location => `${location.lat},${location.lon}`,
    staleMs: STALE_MS,
    now: () => Date.now(),
    ...overrides,
  })
}

/** Lets pending promise callbacks run. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ForecastStore', () => {
  it('starts from the persisted cache and does not fetch a fresh one', () => {
    const { fetchForecast } = controlledFetch()
    const cached = forecast(T0 - 5 * 60 * 1000)
    const forecasts = store({ fetchForecast, readCache: () => cached })
    const stop = forecasts.subscribe(LA, () => {})
    expect(forecasts.getState(LA)).toMatchObject({ data: cached, pending: false, error: false })
    expect(fetchForecast).not.toHaveBeenCalled()
    stop()
  })

  it('shows a stale cached forecast while it fetches a fresh one', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const cached = forecast(T0 - 45 * 60 * 1000, 3)
    const forecasts = store({ fetchForecast, readCache: () => cached })
    const listener = vi.fn()
    forecasts.subscribe(LA, listener)
    expect(forecasts.getState(LA).data).toBe(cached)
    expect(calls).toHaveLength(1)

    const fresh = forecast(T0, 7)
    calls[0]!.resolve(fresh)
    await settle()
    expect(forecasts.getState(LA)).toMatchObject({ data: fresh, updatedAt: T0, error: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('is pending until the first forecast arrives, and keeps one state object per change', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const forecasts = store({ fetchForecast })
    const before = forecasts.getState(LA)
    forecasts.subscribe(LA, () => {})
    expect(forecasts.getState(LA)).toBe(before)
    expect(before).toMatchObject({ data: undefined, pending: true, error: false })
    calls[0]!.resolve(forecast(T0))
    await settle()
    expect(forecasts.getState(LA)).not.toBe(before)
    expect(forecasts.getState(LA).pending).toBe(false)
  })

  it('shares one request between screens showing the same place', () => {
    const { fetchForecast } = controlledFetch()
    const forecasts = store({ fetchForecast })
    forecasts.subscribe(LA, () => {})
    forecasts.subscribe({ ...LA }, () => {})
    forecasts.refetch(LA)
    expect(fetchForecast).toHaveBeenCalledTimes(1)
  })

  it('aborts the request when no screen shows the place any more', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const forecasts = store({ fetchForecast })
    const stopLA = forecasts.subscribe(LA, () => {})
    forecasts.subscribe(SD, () => {})
    stopLA()
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(calls[1]!.signal.aborted).toBe(false)
    await settle()
    // An abort is not an error, and the place fetches again when shown again.
    expect(forecasts.getState(LA)).toMatchObject({ error: false, pending: true })
    forecasts.subscribe(LA, () => {})
    expect(calls).toHaveLength(3)
  })

  it('retries a failed request once, then reports the error and keeps the last forecast', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const cached = forecast(T0 - 45 * 60 * 1000)
    const forecasts = store({ fetchForecast, readCache: () => cached })
    forecasts.subscribe(LA, () => {})
    calls[0]!.reject(new Error('503'))
    await settle()
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(2)
    calls[1]!.reject(new Error('503'))
    await settle()
    expect(forecasts.getState(LA)).toMatchObject({ data: cached, error: true, pending: false })

    // A later success clears the error.
    forecasts.refetch(LA)
    calls[2]!.resolve(forecast(T0))
    await settle()
    expect(forecasts.getState(LA)).toMatchObject({ error: false, updatedAt: T0 })
  })

  it('reports an error without data as no longer pending', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const forecasts = store({ fetchForecast })
    forecasts.subscribe(LA, () => {})
    calls[0]!.reject(new Error('down'))
    await vi.advanceTimersByTimeAsync(1000)
    calls[1]!.reject(new Error('down'))
    await settle()
    expect(forecasts.getState(LA)).toMatchObject({ data: undefined, error: true, pending: false })
  })

  it('refreshes every stale period while shown, and stops when no longer shown', async () => {
    const { calls, fetchForecast } = controlledFetch()
    const forecasts = store({ fetchForecast, readCache: () => forecast(T0) })
    const stop = forecasts.subscribe(LA, () => {})
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(STALE_MS)
    expect(calls).toHaveLength(1)
    calls[0]!.resolve(forecast(Date.now()))
    await settle()
    stop()
    await vi.advanceTimersByTimeAsync(3 * STALE_MS)
    expect(calls).toHaveLength(1)
  })

  it('clear() drops everything, aborts requests and restarts the places still shown', async () => {
    const { calls, fetchForecast } = controlledFetch()
    let cache: ForecastData | null = forecast(T0 - 45 * 60 * 1000)
    const forecasts = store({ fetchForecast, readCache: () => cache })
    const listener = vi.fn()
    forecasts.subscribe(LA, listener)
    expect(calls).toHaveLength(1)

    cache = null
    forecasts.clear()
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(listener).toHaveBeenCalled()
    expect(forecasts.getState(LA)).toMatchObject({ data: undefined, pending: true })
    // The screen still showing Los Angeles gets a fresh request.
    expect(calls).toHaveLength(2)
    calls[1]!.resolve(forecast(T0))
    await settle()
    expect(forecasts.getState(LA).data?.fetchedAt).toBe(T0)
    // The old request's late answer can never land.
    calls[0]!.resolve(forecast(T0 - 1))
    await settle()
    expect(forecasts.getState(LA).data?.fetchedAt).toBe(T0)
  })

  it('forgets a place nobody has shown for a while', () => {
    const readCache = vi.fn(() => forecast(T0))
    const forecasts = store({ readCache })
    forecasts.subscribe(LA, () => {})()
    forecasts.getState(LA)
    expect(readCache).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30 * 60 * 1000)
    forecasts.getState(LA)
    expect(readCache).toHaveBeenCalledTimes(2)
  })
})
