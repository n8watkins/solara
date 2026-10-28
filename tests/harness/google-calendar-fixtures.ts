// Events already in Google Calendar for the UI harness (?gcal=on, which stands in for
// NEXT_PUBLIC_GOOGLE_CALENDAR_EVENTS_ENABLED and the OAuth client ID). A fake of Google's
// side (the GoogleCalendarApi of lib/google-events.ts) answers with Calendar API shaped
// events, so the real parsing, de-duplication and storing run in the page; an in-memory
// GoogleLinkStore stands in for users/{uid}/meta/googleCalendar.
//   google = none (default) | connected: the account already shows its main calendar,
//            refreshed 2 hours ago, with two of its events stored
import type { ImportedEvent } from '@solara/core/event-import'
import type { CalendarEventsPage, CalendarListEntry } from '@/lib/gcal'
import type { GoogleCalendarApi, GoogleCalendarLink, GoogleLinkStore } from '@/lib/google-events'
import { HARNESS_DATE, HARNESS_NOW_MS, HARNESS_TIMEZONE } from './clock'
import { SAN_DIEGO } from './event-fixtures'

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
/** A wall-clock time in Los Angeles in June (PDT) as Google writes it. */
const pdt = (date: string, time: string) => `${date}T${time}:00-07:00`

/** The person's calendars, as the calendar list names them. */
export const HARNESS_CALENDARS: CalendarListEntry[] = [
  { id: 'harness-user@example.com', name: 'harness-user@example.com', primary: true },
  { id: 'trailrunners@group.calendar.google.com', name: 'LA Trail Runners', primary: false },
  {
    id: 'en.usa#holiday@group.v.calendar.google.com',
    name: 'Holidays in United States',
    primary: false,
  },
]

function timed(
  id: string,
  summary: string,
  date: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    iCalUID: `${id}@google.com`,
    status: 'confirmed',
    summary,
    start: { dateTime: pdt(date, from), timeZone: HARNESS_TIMEZONE },
    end: { dateTime: pdt(date, to), timeZone: HARNESS_TIMEZONE },
    ...extra,
  }
}

/** Events on each calendar, as events.list returns them (with Solara's `fields`). */
export const HARNESS_GOOGLE_EVENTS: Record<string, unknown[]> = {
  primary: [
    timed('standup', 'Team standup', HARNESS_DATE, '13:00', '13:15', {
      location: 'https://meet.google.com/abc-defg-hij',
    }),
    timed('picnic', 'Family picnic', '2026-06-16', '12:00', '14:00', {
      location: 'Balboa Park, San Diego, CA',
    }),
    timed('run', 'Morning run', '2026-06-17', '07:00', '08:00'),
    {
      id: 'offsite',
      iCalUID: 'offsite@google.com',
      status: 'confirmed',
      summary: 'Company offsite',
      start: { date: '2026-06-18' },
      end: { date: '2026-06-19' },
    },
    timed('declined', 'Beach volleyball', '2026-06-19', '15:00', '17:00', {
      location: 'Mission Beach, San Diego, CA',
      attendees: [{ self: true, responseStatus: 'declined' }],
    }),
  ],
  'trailrunners@group.calendar.google.com': [
    timed('hike', 'Saturday hike', '2026-06-20', '08:00', '11:00', {
      location: 'Torrey Pines, San Diego, CA',
    }),
  ],
  'en.usa#holiday@group.v.calendar.google.com': [],
}

/** What ?google=connected starts with: two of the primary calendar's events, stored. */
export function buildGoogleEvents(): ImportedEvent[] {
  const base = {
    source: 'google' as const,
    timeZone: HARNESS_TIMEZONE,
    url: '',
    createdAt: iso(HARNESS_NOW_MS - 2 * HOUR),
    updatedAt: iso(HARNESS_NOW_MS - 2 * HOUR),
  }
  return [
    {
      ...base,
      key: 'b1'.padEnd(32, '0'),
      seriesId: 'b1'.padEnd(32, 'f'),
      title: 'Family picnic',
      start: new Date(pdt('2026-06-16', '12:00')).toISOString(),
      end: new Date(pdt('2026-06-16', '14:00')).toISOString(),
      where: 'Balboa Park, San Diego, CA',
      ...SAN_DIEGO,
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      activityId: '',
    },
    {
      ...base,
      key: 'b2'.padEnd(32, '0'),
      seriesId: 'b2'.padEnd(32, 'f'),
      title: 'Morning run',
      start: new Date(pdt('2026-06-17', '07:00')).toISOString(),
      end: new Date(pdt('2026-06-17', '08:00')).toISOString(),
      where: '',
      lat: 34.05,
      lon: -118.24,
      placeLabel: 'Los Angeles, California',
      placeGuessed: true,
      activityId: 'run',
    },
  ]
}

export function buildGoogleLink(): GoogleCalendarLink {
  return {
    calendars: [{ id: 'primary', name: '' }],
    connectedAt: iso(HARNESS_NOW_MS - 3 * 24 * HOUR),
    syncedAt: iso(HARNESS_NOW_MS - 2 * HOUR),
  }
}

/** What the fake Google did, for specs to read (window.__solaraGoogle). */
export interface FakeGoogleLog {
  tokenRequests: { scope: string; interactive: boolean }[]
  listed: string[]
  revoked: number
}

/**
 * Google, faked: consent is granted at once (unless window.__solaraGooglePopup is
 * 'closed'), tokens last for the page, and events come from HARNESS_GOOGLE_EVENTS.
 */
export function createFakeGoogleCalendarApi(): GoogleCalendarApi {
  const tokens = new Set<string>()
  const log: FakeGoogleLog = { tokenRequests: [], listed: [], revoked: 0 }
  ;(window as Window & { __solaraGoogle?: FakeGoogleLog }).__solaraGoogle = log
  return {
    hasToken: scope => tokens.has(scope),
    async requestToken(scope, { interactive }) {
      log.tokenRequests.push({ scope, interactive })
      if (tokens.has(scope)) return `token-${scope}`
      if (!interactive) throw authError('no_token')
      if ((window as Window & { __solaraGooglePopup?: string }).__solaraGooglePopup === 'closed') {
        throw authError('popup_closed')
      }
      tokens.add(scope)
      return `token-${scope}`
    },
    async listCalendars() {
      return HARNESS_CALENDARS
    },
    async listEvents(_token, calendarId): Promise<CalendarEventsPage | null> {
      log.listed.push(calendarId)
      const items = HARNESS_GOOGLE_EVENTS[calendarId]
      return items ? { timeZone: HARNESS_TIMEZONE, items } : null
    },
    async revoke() {
      const had = tokens.size > 0
      tokens.clear()
      if (had) log.revoked += 1
      return had
    },
  }
}

/** The error lib/gcal.ts throws for a token problem (authProblem reads name and reason). */
function authError(reason: string): Error {
  return Object.assign(new Error(`Google Calendar was not connected (${reason})`), {
    name: 'CalendarAuthError',
    reason,
  })
}

export function createMemoryGoogleLinkStore(
  initial: GoogleCalendarLink | null = null,
): GoogleLinkStore {
  let link = initial
  const listeners = new Set<(link: GoogleCalendarLink | null) => void>()
  const emit = () => {
    for (const listener of listeners) listener(link)
  }
  return {
    subscribe(_uid, onChange) {
      listeners.add(onChange)
      queueMicrotask(() => onChange(link))
      return () => listeners.delete(onChange)
    },
    async read() {
      return link
    },
    async save(_uid, next) {
      link = next
      emit()
    },
    async update(_uid, patch) {
      if (!link) return false
      link = { ...link, ...patch }
      emit()
      return true
    },
    async remove() {
      link = null
      emit()
    },
  }
}
