'use client'
import { useState } from 'react'
import type * as GoogleCalendar from '@/lib/gcal'
import type { BusyPeriod } from '@/lib/gcal-view'
import { freeBusyRange } from '@/lib/dashboard-view'

export type CalendarBusyStatus = 'idle' | 'connecting' | 'connected' | 'error'

/**
 * Google Calendar free/busy for the dashboard's recommendations. `connect` asks
 * for a read-only token and loads the busy blocks from now through the
 * account's visible days. Solara sees only when the person is busy, never
 * event details. The Calendar code (lib/gcal.ts) loads on the first connect; it is
 * fetched in the background soon after the page loads (components/deferred.tsx).
 */
export function useCalendarBusy(accessibleDays: number) {
  const [busy, setBusy] = useState<BusyPeriod[] | null>(null)
  const [status, setStatus] = useState<CalendarBusyStatus>('idle')

  async function connect() {
    setStatus('connecting')
    let gcal: typeof GoogleCalendar | null = null
    try {
      gcal = await import('@/lib/gcal')
      const token = await gcal.requestAccessToken()
      const { timeMin, timeMax } = freeBusyRange(Date.now(), accessibleDays)
      setBusy(await gcal.fetchFreeBusy(token, timeMin, timeMax))
      setStatus('connected')
    } catch (error) {
      // Closing the consent popup is the person's choice, not a failure.
      setStatus(gcal?.isConsentDismissed(error) ? 'idle' : 'error')
    }
  }

  return { busy, status, connect }
}
