'use client'
import { WifiOff } from 'lucide-react'
import { forecastStamp, useOnline } from '@/lib/offline'
import type { WeatherResponse } from '@/lib/types'
import { useUnits } from '@/lib/use-units'
import AppNotice from './AppNotice'

/**
 * Says the app is offline and how old the forecast on screen is. The app opens offline
 * from the app-shell service worker (scripts/sw/shell.ts) with the last forecast for
 * the place from this browser's cache (lib/cache.ts); it refreshes by itself once the
 * browser is back online, and this notice goes away.
 */
export default function OfflineNotice({
  weather,
  updatedAt,
  readOnly,
}: {
  /** The forecast on screen, or null when there is none for this place yet. */
  weather: WeatherResponse | null
  /** When that forecast was fetched (ms since the epoch). */
  updatedAt: number
  /** The account is shown from this browser's copy and cannot be changed yet. */
  readOnly?: boolean
}) {
  const online = useOnline()
  const fmt = useUnits()
  if (online) return null
  const message =
    weather && updatedAt
      ? `You're offline. Showing the forecast updated at ${forecastStamp(updatedAt, weather.now, fmt.time)}.`
      : "You're offline. The forecast will load when you're back online."
  return (
    <AppNotice
      tone="notice"
      role="status"
      icon={<WifiOff aria-hidden="true" size={16} strokeWidth={2.25} />}
    >
      {message}
      {readOnly && " You can make changes once you're back online."}
    </AppNotice>
  )
}
