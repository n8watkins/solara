import { useState } from 'react'
import { fetchFreeBusy, requestAccessToken, type BusyPeriod } from './gcal'
import { freeBusyRange } from './dashboard-view'

export type CalendarBusyStatus = 'idle' | 'connecting' | 'connected' | 'error'

/**
 * Google Calendar free/busy for the dashboard's recommendations. `connect` asks
 * for a read-only token and loads the busy blocks from now through the
 * account's visible days. Solara sees only when the person is busy, never
 * event details.
 */
export function useCalendarBusy(accessibleDays: number) {
  const [busy, setBusy] = useState<BusyPeriod[] | null>(null)
  const [status, setStatus] = useState<CalendarBusyStatus>('idle')

  async function connect() {
    setStatus('connecting')
    try {
      const token = await requestAccessToken()
      const { timeMin, timeMax } = freeBusyRange(Date.now(), accessibleDays)
      setBusy(await fetchFreeBusy(token, timeMin, timeMax))
      setStatus('connected')
    } catch {
      setStatus('error')
    }
  }

  return { busy, status, connect }
}
