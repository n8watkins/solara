import { windowEventSummary } from '@solara/core'
import type { BusyInterval, SlotRecommendation } from './scheduler'
import type { Activity } from './types'
import { fmtClock } from './weather'

// Google Calendar access for a static app: the browser gets a short-lived OAuth
// access token via Google Identity Services (incremental authorization, decoupled
// from Firebase login) and calls the Calendar REST API directly.
//
// Two narrow scopes, each requested only when needed:
// - connect: `calendar.freebusy` lets Solara see *when* you are busy, never event
//   titles, attendees or other details.
// - booking: `calendar.events.owned` lets Solara add an event to a calendar you
//   own, requested the first time you book and never for reading events.
//
// Configured via env so the repo ships no client ID. When unset, the UI hides
// the "connect calendar" affordance and recommendations run calendar-free.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
// Keep in sync with the OAuth consent screen and the privacy policy.
export const CALENDAR_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'
export const CALENDAR_BOOKING_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'
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
 * Run the GIS token client to get a short-lived access token for `scope`.
 * Prompts for consent the first time. Token lives in memory for the session.
 */
async function getToken(scope: string): Promise<string> {
  if (!CLIENT_ID) throw new Error('Calendar integration is not configured')
  await loadGis()
  // GIS has no bundled types; access through a narrow cast.
  const oauth2 = (
    window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (cfg: {
              client_id: string
              scope: string
              callback: (resp: { access_token?: string; error?: string }) => void
            }) => { requestAccessToken: (opts?: { prompt?: string }) => void }
          }
        }
      }
    }
  ).google.accounts.oauth2

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      callback: resp => {
        if (resp.error || !resp.access_token) reject(new Error(resp.error || 'No access token'))
        else resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/** Token for the freeBusy query only (the default connection, no event access). */
export function requestAccessToken(): Promise<string> {
  return getToken(CALENDAR_FREEBUSY_SCOPE)
}

/** Token for adding an event to a calendar you own, requested when you book. */
export function requestWriteToken(): Promise<string> {
  return getToken(CALENDAR_BOOKING_SCOPE)
}

/** Query the primary calendar's busy periods over [timeMin, timeMax]. */
export async function fetchFreeBusy(
  token: string,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyPeriod[]> {
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

export interface CalendarEventBody {
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

/** A local, offset-free RFC3339 timestamp ("2026-05-29T17:30:00") from a date + fractional hour. */
function localDateTime(dateStr: string, h: number): string {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) {
    hr += 1
    min = 0
  }
  return `${dateStr}T${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
}

/** PURE. The human-readable event body explaining the pick and its flexibility. */
export function buildEventDescription(
  rec: SlotRecommendation,
  activity: Activity,
  opts: { peakUV?: number; peakHour?: number } = {},
): string {
  const lines: string[] = [
    `Recommended for ${fmtClock(rec.start)}: ${rec.reason.charAt(0).toLowerCase()}${rec.reason.slice(1)}.`,
  ]
  if (rec.latestStart > rec.earliestStart) {
    lines.push(
      `Flexible: start anytime ${fmtClock(rec.earliestStart)}–${fmtClock(rec.latestStart)} within the estimated lower-UV window.`,
    )
  }
  if (typeof opts.peakUV === 'number' && typeof opts.peakHour === 'number') {
    lines.push(`Peak UV ${opts.peakUV.toFixed(1)} around ${fmtClock(opts.peakHour)}.`)
  }
  lines.push(activity.sunscreen ? 'Assumes SPF 30+.' : 'Planned for no sunscreen.')
  lines.push('Forecast-based estimate only. Recheck current UV and use sun protection.')
  lines.push('Planned by Solara ☀️')
  return lines.join('\n')
}

/** PURE. Build the Calendar event resource for a recommended slot. */
export function buildEventBody(
  activity: Activity,
  dateStr: string,
  start: number,
  end: number,
  description: string,
  timeZone: string = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC',
): CalendarEventBody {
  return {
    summary: windowEventSummary(activity),
    description,
    start: { dateTime: localDateTime(dateStr, start), timeZone },
    end: { dateTime: localDateTime(dateStr, end), timeZone },
  }
}

/** Create an event on the user's primary calendar. Returns the created event (incl. htmlLink). */
export async function createCalendarEvent(
  token: string,
  body: CalendarEventBody,
): Promise<{ htmlLink?: string }> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`event create failed: ${res.status}`)
  return res.json()
}
