import * as z from 'zod/mini'
import {
  EVENT_ID_PATTERN,
  SOLARA_ACTIVITY_PROPERTY,
  SOLARA_DATE_PROPERTY,
  SOLARA_EVENT_TAG,
  windowEventSummary,
} from '@solara/core'
import type { BusyInterval, SlotRecommendation } from './scheduler'
import type { Activity } from './types'
import { fmtClock } from './weather'
import { addDays, isIsoDate, zonedInstant } from './time'

// Google Calendar access for a static app: the browser gets a short-lived OAuth
// access token via Google Identity Services (incremental authorization, decoupled
// from Firebase login) and calls the Calendar REST API directly.
//
// Two narrow scopes, each requested only when needed:
// - connect: `calendar.freebusy` lets Solara see *when* you are busy, never event
//   titles, attendees or other details.
// - booking: `calendar.events.owned` lets Solara add an event to a calendar you
//   own, requested the first time you schedule. Solara uses it only on events it
//   created: each one carries a private tag, lookups filter on that tag, and the
//   rest of the calendar is only ever read as free/busy.
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

/** The GIS token client's answer (https://developers.google.com/identity/oauth2/web/reference/js-reference). */
interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
}

/**
 * Google refused the request for lack of a valid token (none yet, expired or revoked).
 * The caller asks the person to reconnect; a token is never requested without a click,
 * because the consent popup needs a user gesture.
 */
export class CalendarAuthError extends Error {
  constructor(message = 'Google Calendar needs to be reconnected') {
    super(message)
    this.name = 'CalendarAuthError'
  }
}

/** Tokens live in memory only, per scope, until shortly before they expire. */
const tokens = new Map<string, { token: string; expiresAt: number }>()
/** Treat a token as expired this long before Google does. */
const EXPIRY_MARGIN_MS = 60_000

/** Drop every cached token (sign-out, account switch, or a 401 from Google). */
export function forgetCalendarTokens(): void {
  tokens.clear()
}

/** A cached, unexpired token for `scope`, or null. */
function cachedToken(scope: string): string | null {
  const entry = tokens.get(scope)
  if (!entry) return null
  if (entry.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) {
    tokens.delete(scope)
    return null
  }
  return entry.token
}

/**
 * Run the GIS token client to get a short-lived access token for `scope`.
 * Prompts for consent the first time. Token lives in memory for the session.
 * With `interactive: false`, only a cached token is returned (no popup).
 */
async function getToken(scope: string, { interactive = true } = {}): Promise<string> {
  const cached = cachedToken(scope)
  if (cached) return cached
  if (!interactive) throw new CalendarAuthError()
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
              callback: (resp: TokenResponse) => void
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
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No access token'))
          return
        }
        const seconds = Number(resp.expires_in)
        tokens.set(scope, {
          token: resp.access_token,
          expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
        })
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

/** Token for the freeBusy query only (the default connection, no event access). */
export function requestAccessToken(): Promise<string> {
  return getToken(CALENDAR_FREEBUSY_SCOPE)
}

/**
 * Token for the events Solara creates on a calendar you own: requested when you
 * schedule, and reused (without a popup) to keep those events in sync.
 */
export function requestWriteToken(options: { interactive?: boolean } = {}): Promise<string> {
  return getToken(CALENDAR_BOOKING_SCOPE, options)
}

/** True when an unexpired event token is in memory, so a sync needs no popup. */
export function hasWriteToken(): boolean {
  return cachedToken(CALENDAR_BOOKING_SCOPE) !== null
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
 * hours since local midnight of `dateStr` (YYYY-MM-DD) in the forecast location's
 * `timeZone`, clipped to the day. Handles multi-day and midnight-spanning events
 * and 23- or 25-hour DST days; drops periods that miss the day. The engine's
 * subtractBusy sorts and merges, so no need to here.
 */
export function busyIntervalsForDay(
  periods: BusyPeriod[],
  dateStr: string,
  timeZone: string,
): BusyInterval[] {
  if (!isIsoDate(dateStr)) return []
  const dayStart = zonedInstant(dateStr, 0, timeZone)
  const dayEnd = zonedInstant(addDays(dateStr, 1), 0, timeZone)
  if (Number.isNaN(dayStart) || Number.isNaN(dayEnd)) return []

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

export interface EventTime {
  dateTime: string
  timeZone: string
}

export interface CalendarEventBody {
  summary: string
  description: string
  start: EventTime
  end: EventTime
  /** Tags the event as Solara's, so Solara can find only its own events later. */
  extendedProperties: { private: Record<string, string> }
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

/** PURE. Start and end of an event on `dateStr` at fractional hours, in `timeZone`. */
export function eventTimes(
  dateStr: string,
  start: number,
  end: number,
  timeZone: string,
): { start: EventTime; end: EventTime } {
  return {
    start: { dateTime: localDateTime(dateStr, start), timeZone },
    end: { dateTime: localDateTime(dateStr, end), timeZone },
  }
}

/** PURE. Build the Calendar event resource for a recommended slot. */
export function buildEventBody(
  activity: Activity,
  dateStr: string,
  start: number,
  end: number,
  description: string,
  timeZone: string,
): CalendarEventBody {
  return {
    summary: windowEventSummary(activity),
    description,
    ...eventTimes(dateStr, start, end, timeZone),
    extendedProperties: {
      private: {
        [SOLARA_EVENT_TAG.key]: SOLARA_EVENT_TAG.value,
        [SOLARA_ACTIVITY_PROPERTY]: activity.id,
        [SOLARA_DATE_PROPERTY]: dateStr,
      },
    },
  }
}

// ---- Events Solara created ----------------------------------------------------------
//
// Everything below works only on events tagged by buildEventBody: the list call
// filters on the private tag, and single-event calls use ids Solara stored itself.

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const eventTimeSchema = z.object({
  dateTime: z.optional(z.string()),
  date: z.optional(z.string()),
  timeZone: z.optional(z.string()),
})

/** The fields Solara reads from a Calendar event resource. */
export const GoogleEventSchema = z.object({
  id: z.string().check(z.regex(EVENT_ID_PATTERN)),
  status: z.optional(z.string()),
  htmlLink: z.optional(z.string()),
  summary: z.optional(z.string()),
  start: z.optional(eventTimeSchema),
  end: z.optional(eventTimeSchema),
  extendedProperties: z.optional(
    z.object({ private: z.optional(z.record(z.string(), z.string())) }),
  ),
})
export type GoogleEvent = z.infer<typeof GoogleEventSchema>

const eventListSchema = z.object({
  items: z.optional(z.array(z.unknown())),
  nextPageToken: z.optional(z.string()),
})

/** Throws CalendarAuthError for 401/403 (and forgets the token), Error otherwise. */
async function calendarFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (res.status === 401 || res.status === 403) {
    tokens.delete(CALENDAR_BOOKING_SCOPE)
    throw new CalendarAuthError()
  }
  return res
}

function parseEvent(raw: unknown): GoogleEvent {
  const parsed = GoogleEventSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Unexpected Google Calendar response')
  return parsed.data
}

/** True when the event carries Solara's private tag. */
export function isSolaraEvent(event: GoogleEvent): boolean {
  return event.extendedProperties?.private?.[SOLARA_EVENT_TAG.key] === SOLARA_EVENT_TAG.value
}

/** Create an event on the user's primary calendar. Returns the created event (incl. htmlLink). */
export async function createCalendarEvent(
  token: string,
  body: CalendarEventBody,
): Promise<GoogleEvent> {
  const res = await calendarFetch(token, EVENTS_URL, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`event create failed: ${res.status}`)
  return parseEvent(await res.json())
}

function eventUrl(eventId: string): string {
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Invalid event id')
  return `${EVENTS_URL}/${encodeURIComponent(eventId)}`
}

/** Move one of Solara's events to new start and end times. */
export async function patchCalendarEventTime(
  token: string,
  eventId: string,
  times: { start: EventTime; end: EventTime },
): Promise<GoogleEvent> {
  const res = await calendarFetch(token, eventUrl(eventId), {
    method: 'PATCH',
    body: JSON.stringify(times),
  })
  if (!res.ok) throw new Error(`event update failed: ${res.status}`)
  return parseEvent(await res.json())
}

/** Delete one of Solara's events. An event that is already gone counts as deleted. */
export async function deleteCalendarEvent(token: string, eventId: string): Promise<void> {
  const res = await calendarFetch(token, eventUrl(eventId), { method: 'DELETE' })
  if (res.ok || res.status === 404 || res.status === 410) return
  throw new Error(`event delete failed: ${res.status}`)
}

/** One of Solara's events by id, or null when it no longer exists. */
export async function getCalendarEvent(
  token: string,
  eventId: string,
): Promise<GoogleEvent | null> {
  const res = await calendarFetch(token, eventUrl(eventId))
  if (res.status === 404 || res.status === 410) return null
  if (!res.ok) throw new Error(`event lookup failed: ${res.status}`)
  return parseEvent(await res.json())
}

/**
 * Solara's own events over [timeMin, timeMax], including cancelled ones, found by the
 * private tag. Google applies the filter, so no other event ever reaches the browser.
 */
export async function listSolaraEvents(
  token: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  // A page holds up to 250 events; ten pages is far beyond what Solara creates.
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      privateExtendedProperty: `${SOLARA_EVENT_TAG.key}=${SOLARA_EVENT_TAG.value}`,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await calendarFetch(token, `${EVENTS_URL}?${params}`)
    if (!res.ok) throw new Error(`event list failed: ${res.status}`)
    const parsed = eventListSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error('Unexpected Google Calendar response')
    for (const raw of parsed.data.items ?? []) {
      const event = GoogleEventSchema.safeParse(raw)
      if (event.success && isSolaraEvent(event.data)) events.push(event.data)
    }
    pageToken = parsed.data.nextPageToken
    if (!pageToken) break
  }
  return events
}
