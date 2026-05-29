import { BusyInterval } from './scheduler'

// Google Calendar read access for a static app: the browser gets a short-lived
// OAuth access token via Google Identity Services (incremental authorization,
// decoupled from Firebase login) and calls the Calendar REST API directly.
// Read scope is freeBusy only — we see *when* you're busy, never event details.
//
// Configured via env so the repo ships no client ID. When unset, the UI hides
// the "connect calendar" affordance and recommendations run calendar-free.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const GSI_SRC = 'https://accounts.google.com/gsi/client'

/** A busy block from the freeBusy API, as RFC3339 timestamps. */
export interface BusyPeriod {
  start: string
  end: string
}

export function isCalendarConfigured(): boolean {
  return !!CLIENT_ID
}

let gisLoader: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (gisLoader) return gisLoader
  gisLoader = new Promise<void>((resolve, reject) => {
    if ((window as Window & { google?: unknown }).google) return resolve()
    const s = document.createElement('script')
    s.src = GSI_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoader
}

/**
 * Run the GIS token client to get a short-lived calendar.readonly access token.
 * Prompts for consent the first time. Token lives in memory for the session.
 */
export async function requestAccessToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error('Calendar integration is not configured')
  await loadGis()
  // GIS has no bundled types; access through a narrow cast.
  const oauth2 = (window as unknown as {
    google: { accounts: { oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (resp: { access_token?: string; error?: string }) => void
      }) => { requestAccessToken: (opts?: { prompt?: string }) => void }
    } } }
  }).google.accounts.oauth2

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: resp => {
        if (resp.error || !resp.access_token) reject(new Error(resp.error || 'No access token'))
        else resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/** Query the primary calendar's busy periods over [timeMin, timeMax]. */
export async function fetchFreeBusy(token: string, timeMin: Date, timeMax: Date): Promise<BusyPeriod[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    }),
  })
  if (!res.ok) throw new Error(`freeBusy request failed: ${res.status}`)
  const data = await res.json()
  return data?.calendars?.primary?.busy ?? []
}

/**
 * PURE. Convert absolute busy periods into per-day busy intervals in fractional
 * hours since local midnight of `dateStr` (YYYY-MM-DD), clipped to [0, 24].
 * Handles multi-day and midnight-spanning events; drops periods that miss the day.
 *
 * Assumes the device timezone matches the forecast location's timezone (the
 * common case — checking the weather where you are). The engine's subtractBusy
 * sorts/merges, so no need to here.
 */
export function busyIntervalsForDay(periods: BusyPeriod[], dateStr: string): BusyInterval[] {
  const dayStart = new Date(`${dateStr}T00:00:00`).getTime()
  if (Number.isNaN(dayStart)) return []
  const dayEnd = dayStart + 24 * 3_600_000

  const out: BusyInterval[] = []
  for (const p of periods) {
    const s = new Date(p.start).getTime()
    const e = new Date(p.end).getTime()
    if (Number.isNaN(s) || Number.isNaN(e)) continue
    const overlapStart = Math.max(s, dayStart)
    const overlapEnd = Math.min(e, dayEnd)
    if (overlapEnd <= overlapStart) continue
    out.push({
      start: (overlapStart - dayStart) / 3_600_000,
      end: (overlapEnd - dayStart) / 3_600_000,
    })
  }
  return out
}
