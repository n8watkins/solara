'use client'
import { useEffect } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { getCachedForecast, locationKey, setCachedForecast } from './cache'
import { fetchForecast, forecastView } from './forecast'
import { resolveTimeZone, zonedNow } from './time'
import type { Location, WeatherResponse } from './types'
import { useZonedNow } from './use-zoned-now'

// The forecast data layer. TanStack Query owns fetching: one request per
// location at a time (the dashboard and calendar share it), the request is
// aborted when nobody needs it any more (for example after switching location),
// and a forecast older than FORECAST_STALE_MS is refreshed in the background
// while the cached one stays on screen. The persisted per-location cache
// (lib/cache.ts) seeds the query, so a reload or a location switch paints the
// last known forecast at once.

/** A forecast younger than this is shown without refetching. */
export const FORECAST_STALE_MS = 30 * 60 * 1000

/** Query key prefix for every forecast; remove it to drop all cached forecasts. */
export const FORECAST_QUERY_KEY = ['forecast'] as const

export function forecastQueryKey(lat: number, lon: number) {
  return [...FORECAST_QUERY_KEY, locationKey(lat, lon)] as const
}

/** The app's query client: one quick retry, then the error banner offers a manual one. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true, gcTime: 30 * 60 * 1000 },
    },
  })
}

export function useForecast(location: Location | null | undefined) {
  const lat = location?.lat ?? NaN
  const lon = location?.lon ?? NaN
  return useQuery({
    queryKey: forecastQueryKey(lat, lon),
    enabled: !!location,
    queryFn: async ({ signal }) => {
      if (!location) throw new Error('No location')
      const data = await fetchForecast(location, { signal })
      setCachedForecast(location.lat, location.lon, data)
      return data
    },
    initialData: () => (location ? (getCachedForecast(lat, lon) ?? undefined) : undefined),
    initialDataUpdatedAt: () => (location ? getCachedForecast(lat, lon)?.fetchedAt : undefined),
    staleTime: FORECAST_STALE_MS,
    // Keep "now" current on a screen left open.
    refetchInterval: FORECAST_STALE_MS,
  })
}

export interface WeatherState {
  /** The forecast as seen now in the location's zone, or null until one is loaded. */
  weather: WeatherResponse | null
  /** True while the first forecast for the location is loading. */
  loading: boolean
  /** A message when the last fetch failed (the last forecast, if any, stays on screen). */
  error: string | null
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
    if (fetchedDate && fetchedDate < now.date) void refetch()
  }, [fetchedDate, now.date, refetch])
  return {
    weather,
    loading: !weather && forecast.isPending && !!location,
    error: forecast.isError
      ? weather
        ? 'Could not refresh weather data. Showing the last forecast.'
        : 'Could not load weather data.'
      : null,
    refresh: () => void refetch(),
  }
}
