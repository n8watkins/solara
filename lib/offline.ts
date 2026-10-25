'use client'
import { useSyncExternalStore } from 'react'
import { addDays, formatDate, zonedNow, type ZonedNow } from './time'

// Offline state for components/OfflineNotice.tsx: whether the browser says it is
// online, and when the forecast on screen was fetched, said in the location's own
// clock like every other time in the app.

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** False while the browser reports no network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * When a forecast was fetched, as the "updated at" stamp says it: "9:41am" today,
 * "yesterday, 9:41pm", or "Oct 23, 9:41pm", in the forecast location's zone (`now`).
 * `time` formats fractional hours in the display units (lib/units.ts).
 */
export function forecastStamp(
  fetchedAt: number,
  now: ZonedNow,
  time: (hours: number) => string,
): string {
  const at = zonedNow(now.timeZone, fetchedAt)
  const clock = time(at.hour + at.minute / 60)
  if (at.date === now.date) return clock
  if (at.date === addDays(now.date, -1)) return `yesterday, ${clock}`
  return `${formatDate(at.date, { month: 'short', day: 'numeric' })}, ${clock}`
}
