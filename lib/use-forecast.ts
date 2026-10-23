'use client'
import { useQuery } from '@tanstack/react-query'
import { getCachedForecast, locationKey, setCachedForecast } from './cache'
import { fetchForecast } from './forecast'
import type { Location } from './types'

// The forecast data layer. TanStack Query owns fetching: one request per
// location at a time (the dashboard and calendar share it), the request is
// aborted when nobody needs it any more (for example after switching location),
// and a forecast older than FORECAST_STALE_MS is refreshed in the background
// while the cached one stays on screen. The persisted per-location cache
// (lib/cache.ts) seeds the query, so a reload or a location switch paints the
// last known forecast at once.

/** A forecast younger than this is shown without refetching. */
export const FORECAST_STALE_MS = 30 * 60 * 1000

export function forecastQueryKey(lat: number, lon: number) {
  return ['forecast', locationKey(lat, lon)] as const
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
