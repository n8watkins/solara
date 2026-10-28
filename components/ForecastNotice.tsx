'use client'
import { History, WifiOff } from 'lucide-react'
import { forecastStamp, useOnline } from '@/lib/offline'
import type { WeatherResponse } from '@/lib/types'
import { useUnits } from '@/lib/use-units'
import AppNotice from './AppNotice'

/**
 * Says when the forecast on screen is not a current one, and how old it is, in the
 * place's own clock. At most one note shows:
 * - offline: the app opens from the app-shell service worker (scripts/sw/shell.ts) with
 *   the last forecast for the place from this browser's cache (lib/cache.ts), and
 *   refreshes by itself once the browser is back online, when this note goes away;
 * - stale: the forecast proxy answered with its last good copy from an earlier hour
 *   because its upstream budget was spent (ForecastData.stale); the next refresh
 *   replaces it. Most builds have no proxy, and then this never shows.
 */
export default function ForecastNotice({
  weather,
  updatedAt,
  stale,
  readOnly,
}: {
  /** The forecast on screen, or null when there is none for this place yet. */
  weather: WeatherResponse | null
  /** When that forecast was fetched (ms since the epoch). */
  updatedAt: number
  /** The forecast is the proxy's earlier copy (lib/use-forecast.ts WeatherState.stale). */
  stale?: boolean
  /** The account is shown from this browser's copy and cannot be changed yet. */
  readOnly?: boolean
}) {
  const online = useOnline()
  const fmt = useUnits()
  const stamp = weather && updatedAt ? forecastStamp(updatedAt, weather.now, fmt.time) : null
  if (online) {
    if (!stale || !stamp) return null
    return (
      <AppNotice
        tone="notice"
        role="status"
        icon={<History aria-hidden="true" size={16} strokeWidth={2.25} />}
      >
        Showing the forecast updated at {stamp}. A newer one will load by itself.
      </AppNotice>
    )
  }
  return (
    <AppNotice
      tone="notice"
      role="status"
      icon={<WifiOff aria-hidden="true" size={16} strokeWidth={2.25} />}
    >
      {stamp
        ? `You're offline. Showing the forecast updated at ${stamp}.`
        : "You're offline. The forecast will load when you're back online."}
      {readOnly && " You can make changes once you're back online."}
    </AppNotice>
  )
}
