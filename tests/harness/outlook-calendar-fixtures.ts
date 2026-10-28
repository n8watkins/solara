// Events already in Outlook for the UI harness (?outlook=on, which stands in for
// NEXT_PUBLIC_OUTLOOK_CALENDAR_EVENTS_ENABLED and the Microsoft client ID). A fake of
// Microsoft's side (the OutlookCalendarApi of lib/outlook-events.ts) answers with Graph
// shaped calendarView items, so the real parsing, de-duplication and storing run in the
// page; an in-memory store stands in for users/{uid}/meta/outlookCalendar.
//   outlookcal = none (default) | connected: the account already shows its default
//            calendar, refreshed 2 hours ago, with two of its events stored
// window.__solaraOutlookPopup = 'closed' | 'blocked' | 'admin' makes the sign-in fail the
// way lib/microsoft-auth.ts reports it.
import type { ImportedEvent } from '@solara/core/event-import'
import type {
  OutlookCalendarApi,
  OutlookCalendarEntry,
  OutlookCalendarLink,
  OutlookEventsPage,
  OutlookLinkStore,
} from '@/lib/outlook-events'
import { HARNESS_DATE, HARNESS_NOW_MS, HARNESS_TIMEZONE } from './clock'
import { SAN_DIEGO } from './event-fixtures'
import { createMemoryLinkStore } from './google-calendar-fixtures'

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
/** A wall-clock time in Los Angeles in June (PDT), as Graph's UTC dateTime (no offset). */
const utc = (date: string, time: string) =>
  `${new Date(`${date}T${time}:00-07:00`).toISOString().slice(0, 19)}.0000000`

/** The person's calendars as Graph lists them, a shared one included (left out by the app). */
export const HARNESS_OUTLOOK_CALENDARS: OutlookCalendarEntry[] = [
  { id: 'AAMkAGI2harnessDefault', name: 'Calendar', isDefault: true },
  { id: 'AAMkAGI2harnessClub', name: 'Running club', isDefault: false },
  { id: 'AAMkAGI2harnessBirthdays', name: 'Birthdays', isDefault: false },
]

function timed(
  id: string,
  subject: string,
  date: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `AAMkAGI2${id}`,
    iCalUId: `040000008200E00074C5B7101A82E008${id}`,
    subject,
    start: { dateTime: utc(date, from), timeZone: 'UTC' },
    end: { dateTime: utc(date, to), timeZone: 'UTC' },
    isAllDay: false,
    isCancelled: false,
    isOnlineMeeting: false,
    responseStatus: { response: 'organizer', time: '0001-01-01T00:00:00Z' },
    type: 'singleInstance',
    originalStartTimeZone: 'Pacific Standard Time',
    location: { displayName: '', locationType: 'default', address: {}, coordinates: {} },
    ...extra,
  }
}

const at = (displayName: string, extra: Record<string, unknown> = {}) => ({
  location: { displayName, locationType: 'default', address: {}, coordinates: {}, ...extra },
})

/** Events on each calendar, as calendarView returns them (with Solara's $select). */
export const HARNESS_OUTLOOK_EVENTS: Record<string, unknown[]> = {
  default: [
    timed('standup', 'Team standup', HARNESS_DATE, '13:00', '13:15', {
      isOnlineMeeting: true,
      ...at('Microsoft Teams Meeting'),
    }),
    timed('picnic', 'Family picnic', '2026-06-16', '12:00', '14:00', {
      ...at('Balboa Park, San Diego, CA'),
    }),
    timed('run', 'Morning run', '2026-06-17', '07:00', '08:00', {
      type: 'occurrence',
      originalStart: `${utc('2026-06-17', '07:00').slice(0, 19)}Z`,
    }),
    timed('offsite', 'Company offsite', '2026-06-18', '00:00', '23:59', { isAllDay: true }),
    timed('room', 'Design review', '2026-06-18', '10:00', '11:00', {
      ...at('Conf Room Rainier', { locationType: 'conferenceRoom' }),
    }),
    timed('declined', 'Beach volleyball', '2026-06-19', '15:00', '17:00', {
      ...at('Mission Beach, San Diego, CA'),
      responseStatus: { response: 'declined' },
    }),
  ],
  AAMkAGI2harnessClub: [
    // A place picked from Outlook's place search: kept by its coordinates.
    timed('hike', 'Saturday hike', '2026-06-20', '08:00', '11:00', {
      ...at('Torrey Pines State Natural Reserve', {
        locationType: 'localBusiness',
        coordinates: { latitude: 32.9216, longitude: -117.2536 },
      }),
    }),
  ],
  AAMkAGI2harnessBirthdays: [],
}

/** What ?outlookcal=connected starts with: two of the default calendar's events, stored. */
export function buildOutlookEvents(): ImportedEvent[] {
  const base = {
    source: 'outlook' as const,
    timeZone: HARNESS_TIMEZONE,
    url: '',
    createdAt: iso(HARNESS_NOW_MS - 2 * HOUR),
    updatedAt: iso(HARNESS_NOW_MS - 2 * HOUR),
  }
  const instant = (date: string, time: string) => new Date(`${date}T${time}:00-07:00`).toISOString()
  return [
    {
      ...base,
      key: 'd1'.padEnd(32, '0'),
      seriesId: 'd1'.padEnd(32, 'f'),
      title: 'Family picnic',
      start: instant('2026-06-16', '12:00'),
      end: instant('2026-06-16', '14:00'),
      where: 'Balboa Park, San Diego, CA',
      ...SAN_DIEGO,
      placeLabel: 'San Diego, California',
      placeGuessed: false,
      activityId: '',
    },
    {
      ...base,
      key: 'd2'.padEnd(32, '0'),
      seriesId: 'd2'.padEnd(32, 'f'),
      title: 'Morning run',
      start: instant('2026-06-17', '07:00'),
      end: instant('2026-06-17', '08:00'),
      where: '',
      lat: 34.05,
      lon: -118.24,
      placeLabel: 'Los Angeles, California',
      placeGuessed: true,
      activityId: 'run',
    },
  ]
}

export function buildOutlookLink(): OutlookCalendarLink {
  return {
    calendars: [{ id: 'default', name: '' }],
    connectedAt: iso(HARNESS_NOW_MS - 3 * 24 * HOUR),
    syncedAt: iso(HARNESS_NOW_MS - 2 * HOUR),
  }
}

/** What the fake Microsoft did, for specs to read (window.__solaraOutlook). */
export interface FakeOutlookLog {
  tokenRequests: { interactive: boolean }[]
  /** Sign-in popups opened (a token request with none in memory, on a click). */
  signIns: number
  listed: string[]
  forgotten: number
}

/** The error lib/microsoft-auth.ts throws (outlookAuthProblem reads its name and reason). */
function authError(reason: string): Error {
  return Object.assign(new Error(`Outlook was not connected (${reason})`), {
    name: 'CalendarAuthError',
    reason,
  })
}

/**
 * Microsoft, faked: the sign-in succeeds at once (unless window.__solaraOutlookPopup says
 * otherwise), the token lasts for the page, and events come from HARNESS_OUTLOOK_EVENTS.
 */
export function createFakeOutlookCalendarApi(): OutlookCalendarApi {
  let token: string | null = null
  const log: FakeOutlookLog = { tokenRequests: [], signIns: 0, listed: [], forgotten: 0 }
  ;(window as Window & { __solaraOutlook?: FakeOutlookLog }).__solaraOutlook = log
  return {
    hasToken: () => token !== null,
    async requestToken({ interactive }) {
      log.tokenRequests.push({ interactive })
      if (token) return token
      if (!interactive) throw authError('no_token')
      log.signIns += 1
      const popup = (window as Window & { __solaraOutlookPopup?: string }).__solaraOutlookPopup
      if (popup === 'closed') throw authError('popup_closed')
      if (popup === 'blocked') throw authError('popup_failed_to_open')
      if (popup === 'admin') throw authError('admin_approval')
      token = 'harness-graph-token'
      return token
    },
    async listCalendars() {
      return HARNESS_OUTLOOK_CALENDARS
    },
    async listEvents(_token, calendarId): Promise<OutlookEventsPage | null> {
      log.listed.push(calendarId)
      const items = HARNESS_OUTLOOK_EVENTS[calendarId]
      return items ? { items } : null
    },
    forget() {
      if (token) log.forgotten += 1
      token = null
    },
  }
}

export function createMemoryOutlookLinkStore(
  initial: OutlookCalendarLink | null = null,
): OutlookLinkStore {
  return createMemoryLinkStore(initial)
}
