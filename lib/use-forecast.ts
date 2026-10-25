'use client'
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import { getCachedForecast, locationKey, setCachedForecast } from './cache'
import { fetchForecast, forecastView } from './forecast'
import { ForecastStore, type ForecastState } from './forecast-store'
import { resolveTimeZone, zonedNow } from './time'
import type { Location, WeatherResponse } from './types'
import { useZonedNow } from './use-zoned-now'

// The forecast data layer. lib/forecast-store.ts owns fetching: one request per
// location at a time (the dashboard and calendar share it), the request is aborted
// when nobody needs it any more (for example after switching location), and a
// forecast older than FORECAST_STALE_MS is refreshed in the background while the
// cached one stays on screen. The persisted per-location cache (lib/cache.ts) seeds
// it, so a reload or a location switch paints the last known forecast at once.

/** A forecast younger than this is shown without refetching. */
export const FORECAST_STALE_MS = 30 * 60 * 1000

/** The app's forecast store, persisting every forecast it fetches. */
export function createForecastStore(): ForecastStore {
  return new ForecastStore({
    fetchForecast: async (location, signal) => {
      const data = await fetchForecast(location, { signal })
      setCachedForecast(location.lat, location.lon, data)
      return data
    },
    readCache: location => getCachedForecast(location.lat, location.lon),
    keyOf: location => locationKey(location.lat, location.lon),
    staleMs: FORECAST_STALE_MS,
  })
}

const ForecastStoreContext = createContext<ForecastStore | null>(null)

/** Provides the forecast store to the screens below (one per app). */
export const ForecastStoreProvider = ForecastStoreContext

/** The forecast store from ForecastStoreProvider. */
export function useForecastStore(): ForecastStore {
  const store = useContext(ForecastStoreContext)
  if (!store) throw new Error('useForecastStore needs a ForecastStoreProvider')
  return store
}

const NO_LOCATION: ForecastState = Object.freeze({
  data: undefined,
  updatedAt: 0,
  error: false,
  pending: true,
})
const noSubscription = () => () => {}

/** The forecast state for `location`, loading it while shown. Pass null to load nothing. */
export function useForecast(location: Location | null | undefined) {
  const store = useForecastStore()
  const key = location ? locationKey(location.lat, location.lon) : null
  // Resubscribes only when the place changes, not when the location object does.
  const subscribe = useCallback(
    (listener: () => void) => (location ? store.subscribe(location, listener) : noSubscription()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, key],
  )
  const state = useSyncExternalStore(
    subscribe,
    () => (location ? store.getState(location) : NO_LOCATION),
    () => NO_LOCATION,
  )
  const refetch = useCallback(() => {
    if (location) store.refetch(location)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key])
  return { ...state, refetch }
}

export interface WeatherState {
  /** The forecast as seen now in the location's zone, or null until one is loaded. */
  weather: WeatherResponse | null
  /** True while the first forecast for the location is loading. */
  loading: boolean
  /** A message when the last fetch failed (the last forecast, if any, stays on screen). */
  error: string | null
  /** When the forecast on screen was fetched (ms since the epoch); 0 without one. */
  updatedAt: number
  /** Fetch a fresh forecast now. */
  refresh: () => void
}

/**
 * The forecast for `location` as the screens use it: "today" and "now" are read
 * in the forecast's own time zone from a minute clock, so the view rolls over at
 * the location's midnight, and that day's forecast is refetched when it does.
 * Pass null to load nothing.
 */
export function useWeather(location: Location | null | undefined): WeatherState {
  const forecast = useForecast(location)
  const data = forecast.data
  const now = useZonedNow(resolveTimeZone(data?.timezone, location?.timezone))
  const weather = data ? forecastView(data, now) : null
  const fetchedDate = data ? zonedNow(data.timezone, data.fetchedAt).date : null
  const refetch = forecast.refetch
  useEffect(() => {
    if (fetchedDate && fetchedDate < now.date) refetch()
  }, [fetchedDate, now.date, refetch])
  return {
    weather,
    loading: !weather && forecast.pending && !!location,
    error: forecast.error
      ? weather
        ? 'Could not refresh weather data. Showing the last forecast.'
        : 'Could not load weather data.'
      : null,
    updatedAt: forecast.updatedAt,
    refresh: refetch,
  }
}
