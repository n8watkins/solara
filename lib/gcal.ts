import * as v from 'valibot'
import {
  EVENT_ID_PATTERN,
  isPlainRecord,
  record,
  SOLARA_ACTIVITY_PROPERTY,
  SOLARA_DATE_PROPERTY,
  SOLARA_EVENT_TAG,
  windowEventSummary,
} from '@solara/core'
import type { Activity } from './types'
import { addDays } from './time'
import type { BusyPeriod } from './gcal-view'

export {
  busyIntervalsForDay,
  buildEventDescription,
  isCalendarConfigured,
  type BusyPeriod,
} from './gcal-view'

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
    s.onerror = () => {
      // Let the next click try again (the person may have been offline).
      gisLoader = null
      s.remove()
      reject(new Error('Failed to load Google Identity Services'))
    }
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

/** The GIS token client's non-OAuth failure, reported to `error_callback`. */
interface TokenClientError {
  type?: string
  message?: string
}

/**
 * Why no valid token is available:
 * - `no_token`: none yet, expired, or Google refused the one Solara had.
 * - `popup_closed`: the person closed the consent popup.
 * - `popup_failed_to_open`: the browser blocked the popup.
 * - `timeout`: neither callback fired in time (a safety net, see TOKEN_TIMEOUT_MS).
 * - Any other value is the OAuth error code or GIS error type, such as `access_denied`.
 */
export type CalendarAuthReason =
  'no_token' | 'popup_closed' | 'popup_failed_to_open' | 'timeout' | (string & {})

/**
 * Google refused the request for lack of a valid token (none yet, expired or revoked),
 * or the person did not finish the consent popup.
 * The caller asks the person to reconnect; a token is never requested without a click,
 * because the consent popup needs a user gesture.
 */
export class CalendarAuthError extends Error {
  readonly reason: CalendarAuthReason
  constructor(reason: CalendarAuthReason = 'no_token') {
    super(
      reason === 'no_token'
        ? 'Google Calendar needs to be reconnected'
        : `Google Calendar was not connected (${reason})`,
    )
    this.name = 'CalendarAuthError'
    this.reason = reason
  }
}

/** True when the person dismissed the consent popup themselves, which is not an error. */
export function isConsentDismissed(error: unknown): boolean {
  return error instanceof CalendarAuthError && error.reason === 'popup_closed'
}

/** Tokens live in memory only, per scope, until shortly before they expire. */
const tokens = new Map<string, { token: string; expiresAt: number }>()
/** Treat a token as expired this long before Google does. */
const EXPIRY_MARGIN_MS = 60_000
/**
 * Give up on a token request after this long. GIS reports every outcome through
 * `callback` or `error_callback`, so this only guards against a popup that never
 * reports back; it is long enough to read the consent screen. A token that still
 * arrives later is cached, so the next try needs no popup.
 */
export const TOKEN_TIMEOUT_MS = 3 * 60_000

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
              error_callback: (err: TokenClientError) => void
            }) => { requestAccessToken: (opts?: { prompt?: string }) => void }
          }
        }
      }
    }
  ).google.accounts.oauth2

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => fail(new CalendarAuthError('timeout')), TOKEN_TIMEOUT_MS)
    function fail(error: Error) {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(error)
    }
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      callback: resp => {
        if (resp.error || !resp.access_token) {
          fail(new CalendarAuthError(resp.error || 'no_token'))
          return
        }
        const seconds = Number(resp.expires_in)
        tokens.set(scope, {
          token: resp.access_token,
          expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
        })
        clearTimeout(timer)
        if (settled) return
        settled = true
        resolve(resp.access_token)
      },
      // Closing or blocking the popup never reaches `callback`; without this the
      // promise would never settle and every caller would wait for good.
      error_callback: err => fail(new CalendarAuthError(err?.type || 'unknown')),
    })
    try {
      client.requestAccessToken({ prompt: '' })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
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
  const res = await calendarFetch(
    token,
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      method: 'POST',
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }],
      }),
    },
    CALENDAR_FREEBUSY_SCOPE,
  )
  if (!res.ok) throw new Error(`freeBusy request failed: ${res.status}`)
  const data = await res.json()
  return data?.calendars?.primary?.busy ?? []
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

/**
 * A local, offset-free RFC3339 timestamp ("2026-05-29T17:30:00") from a date + fractional
 * hour. An hour of 24 or more rolls over to the next day, because Google rejects
 * "T24:00:00". Recommended slots end by the day's last hourly sample (23 at most, see
 * findWindows in @solara/core), so this is only a guard for callers that pass midnight.
 */
function localDateTime(dateStr: string, h: number): string {
  const totalMins = Math.round(h * 60)
  const days = Math.floor(totalMins / (24 * 60))
  const mins = totalMins - days * 24 * 60
  const date = days ? addDays(dateStr, days) : dateStr
  const hr = Math.floor(mins / 60)
  const min = mins % 60
  return `${date}T${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
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

const eventTimeSchema = record({
  dateTime: v.optional(v.string()),
  date: v.optional(v.string()),
  timeZone: v.optional(v.string()),
})

/** The fields Solara reads from a Calendar event resource. */
export const GoogleEventSchema = record({
  id: v.pipe(v.string(), v.regex(EVENT_ID_PATTERN)),
  status: v.optional(v.string()),
  htmlLink: v.optional(v.string()),
  summary: v.optional(v.string()),
  start: v.optional(eventTimeSchema),
  end: v.optional(eventTimeSchema),
  extendedProperties: v.optional(
    record({
      private: v.optional(
        v.pipe(v.custom<Record<string, unknown>>(isPlainRecord), v.record(v.string(), v.string())),
      ),
    }),
  ),
})
export type GoogleEvent = v.InferOutput<typeof GoogleEventSchema>

const eventListSchema = record({
  items: v.optional(v.array(v.unknown())),
  nextPageToken: v.optional(v.string()),
})

/**
 * 403 reasons that are not about the token: rate limits, quotas, and rules on the
 * event itself (Google lists them in the Calendar API's "Handle API errors" guide).
 * Another token would not help, so the token is kept and the person is not asked to
 * reconnect. Any other 403 (such as `insufficientPermissions`) counts as a token problem,
 * because asking to reconnect is the only way out of a refused token.
 */
const NON_AUTH_403_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
  'variableTermLimitExceeded',
  'forbiddenForNonOrganizer',
  'forbiddenForServiceAccounts',
])

const googleErrorSchema = record({
  error: v.optional(
    record({
      errors: v.optional(
        v.array(record({ domain: v.optional(v.string()), reason: v.optional(v.string()) })),
      ),
    }),
  ),
})

/**
 * The reason of a 403 that another token would not fix (a rate limit, a quota, or
 * anything in Google's `usageLimits` domain), or null for a token problem.
 */
async function nonAuthReason(res: Response): Promise<string | null> {
  try {
    const parsed = v.safeParse(googleErrorSchema, await res.clone().json())
    const first = parsed.success ? parsed.output.error?.errors?.[0] : undefined
    if (first?.domain === 'usageLimits') return first.reason || 'usageLimits'
    return first?.reason && NON_AUTH_403_REASONS.has(first.reason) ? first.reason : null
  } catch {
    return null
  }
}

/**
 * Throws CalendarAuthError (and forgets the `scope` token) when Google refuses the
 * token: a 401, or a 403 for a reason another token could fix. A 403 for rate limits
 * or quotas throws a plain Error and keeps the token, so the person can try again.
 */
async function calendarFetch(
  token: string,
  url: string,
  init: RequestInit = {},
  scope: string = CALENDAR_BOOKING_SCOPE,
) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (res.status === 401 || res.status === 403) {
    const reason = res.status === 403 ? await nonAuthReason(res) : null
    if (reason) throw new Error(`Google Calendar refused the request: ${reason}`)
    tokens.delete(scope)
    throw new CalendarAuthError()
  }
  return res
}

function parseEvent(raw: unknown): GoogleEvent {
  const parsed = v.safeParse(GoogleEventSchema, raw)
  if (!parsed.success) throw new Error('Unexpected Google Calendar response')
  return parsed.output
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
    const parsed = v.safeParse(eventListSchema, await res.json())
    if (!parsed.success) throw new Error('Unexpected Google Calendar response')
    for (const raw of parsed.output.items ?? []) {
      const event = v.safeParse(GoogleEventSchema, raw)
      if (event.success && isSolaraEvent(event.output)) events.push(event.output)
    }
    pageToken = parsed.output.nextPageToken
    if (!pageToken) break
  }
  return events
}
