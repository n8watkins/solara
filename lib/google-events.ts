// Events already in Google Calendar (docs/integrations/EVENTS.md, phase 2b): the app's
// side, which is all of it. With the person's consent the browser reads their upcoming
// events (the read-only scope in packages/core/src/google-calendar-events.ts, through
// lib/gcal.ts), keeps those with an address or that match one of their activities, and
// stores them next to imported events (`source: 'google'`), so they get the UV card and
// the Pro heads-ups. Tokens stay in memory, so events refresh only while Solara is open:
// by themselves while this session holds a token, otherwise when the person presses
// Refresh. Only the lazily loaded Events section imports this module.
import { capText, SOLARA_EVENT_TAG } from '@solara/core'
import {
  GOOGLE_CALENDAR_LINK_DOC,
  GOOGLE_EVENT_LIMITS,
  GOOGLE_EVENTS_SCOPE,
  GOOGLE_CALENDAR_LIST_SCOPE,
  IMPORTED_EVENT_LIMITS,
  isIanaTimeZone,
  matchActivity,
  parseGoogleCalendarLink,
  stripInvisibleFormatting,
  type GoogleCalendarChoice,
  type GoogleCalendarLink,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import * as v from 'valibot'
import type * as Gcal from './gcal'
import type { CalendarEventsPage, CalendarListEntry } from './gcal'
import {
  MAX_EVENT_MS,
  addFound,
  calendarLocationQueries,
  calendarSyncSummary,
  disconnectCalendar,
  emptyRead,
  firestoreCalendarLinkStore,
  isMeetingLocation,
  refreshCalendarLink,
  refreshDueAfter,
  removeSourceEvents,
  storeCalendarEvents,
  type CalendarLinkStore,
  type CalendarSkip,
  type StoreContext,
  type SyncOutcome,
} from './calendar-events'
import type { EventsStore } from './events'
import { resolveTimeZone } from './time'
import type { Activity } from './types'

export { calendarsText, isMeetingLocation, syncedText } from './calendar-events'
export type { SyncOutcome } from './calendar-events'
export type { CalendarListEntry, GoogleCalendarChoice, GoogleCalendarLink }
export { GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_SCOPE }

// ---- Google's side, swappable in the UI harness ----------------------------------------

/** What the feature needs from Google: lib/gcal.ts in the app, a fake in the UI harness. */
export interface GoogleCalendarApi {
  /** True when an unexpired token for `scope` is in memory (no popup needed). */
  hasToken(scope: string): boolean
  /** A token for `scope`; `interactive` opens the consent popup, which needs a click. */
  requestToken(scope: string, options: { interactive: boolean }): Promise<string>
  listCalendars(token: string): Promise<CalendarListEntry[]>
  listEvents(
    token: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    page: { pageToken?: string; pageSize: number },
  ): Promise<CalendarEventsPage | null>
  /** Ends Solara's Google Calendar grant; false when no token says whose it is. */
  revoke(): Promise<boolean>
}

/** lib/gcal.ts, loaded on first use. */
export const googleCalendarApi: GoogleCalendarApi = {
  hasToken: scope => gcalLoaded?.hasScopeToken(scope) ?? false,
  async requestToken(scope, options) {
    return (await gcal()).requestScopeToken(scope, options)
  },
  async listCalendars(token) {
    return (await gcal()).listCalendars(token, GOOGLE_CALENDAR_LIST_SCOPE)
  },
  async listEvents(token, calendarId, timeMin, timeMax, page) {
    return (await gcal()).listCalendarEvents(
      token,
      GOOGLE_EVENTS_SCOPE,
      calendarId,
      timeMin,
      timeMax,
      page,
    )
  },
  async revoke() {
    return (await gcal()).revokeCalendarAccess()
  },
}

let gcalLoaded: typeof Gcal | null = null
async function gcal() {
  gcalLoaded ??= await import('./gcal')
  return gcalLoaded
}

/**
 * Why a Google call failed in a way the person must fix by connecting again (lib/gcal.ts
 * CalendarAuthError): an expired or refused token, or a consent popup that did not finish.
 * `dismissed` is true when they closed the popup themselves.
 */
export function authProblem(error: unknown): { dismissed: boolean } | null {
  if (!(error instanceof Error) || error.name !== 'CalendarAuthError') return null
  return { dismissed: (error as Error & { reason?: string }).reason === 'popup_closed' }
}

// ---- Reading one Google event ----------------------------------------------------------

/** Why a Google event is not shown. */
export type GoogleSkip = CalendarSkip

const timeSchema = v.looseObject({
  dateTime: v.optional(v.string()),
  date: v.optional(v.string()),
  timeZone: v.optional(v.string()),
})

const googleEventSchema = v.looseObject({
  id: v.optional(v.string()),
  iCalUID: v.optional(v.string()),
  status: v.optional(v.string()),
  summary: v.optional(v.string()),
  location: v.optional(v.string()),
  start: v.optional(timeSchema),
  end: v.optional(timeSchema),
  recurringEventId: v.optional(v.string()),
  originalStartTime: v.optional(timeSchema),
  extendedProperties: v.optional(
    v.looseObject({ private: v.optional(v.record(v.string(), v.unknown())) }),
  ),
  attendees: v.optional(
    v.array(
      v.looseObject({ self: v.optional(v.boolean()), responseStatus: v.optional(v.string()) }),
    ),
  ),
})

/**
 * PURE. The town-level searches a Google Calendar event's location may make, best first,
 * or none: calendarLocationQueries in lib/calendar-events.ts (REVIEW6 M2).
 */
export const googleLocationQueries = calendarLocationQueries

export interface GoogleEventContext {
  /** The calendar's own zone (from the events page), for events that name none. */
  calendarTimeZone?: string
  /** The person's zone, when neither the event nor the calendar names a valid one. */
  fallbackTimeZone: string
  activities: readonly Pick<Activity, 'id' | 'name'>[]
  nowMs: number
}

/**
 * PURE. A Google Calendar event as the importer's event, or why it is skipped. Kept: timed
 * events that have not ended, are not declined, last at most a week, and have a location
 * that reads as a town (googleLocationQueries) or match one of the person's activities by
 * title. Links and dial-in details are never kept as the location.
 */
export function parseGoogleEvent(
  raw: unknown,
  { calendarTimeZone, fallbackTimeZone, activities, nowMs }: GoogleEventContext,
): { event: ParsedIcsEvent } | { skip: GoogleSkip } {
  const parsed = v.safeParse(googleEventSchema, raw)
  if (!parsed.success) return { skip: 'other' }
  const item = parsed.output
  if (item.status === 'cancelled') return { skip: 'other' }
  // A window Solara added itself already shows under Scheduled.
  if (item.extendedProperties?.private?.[SOLARA_EVENT_TAG.key] === SOLARA_EVENT_TAG.value) {
    return { skip: 'other' }
  }
  if (!item.start?.dateTime || !item.end?.dateTime) {
    return item.start?.date ? { skip: 'allDay' } : { skip: 'other' }
  }
  if (item.attendees?.some(a => a.self && a.responseStatus === 'declined')) {
    return { skip: 'declined' }
  }
  const start = Date.parse(item.start.dateTime)
  const end = Date.parse(item.end.dateTime)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end <= nowMs) {
    return { skip: 'other' }
  }
  if (end - start > MAX_EVENT_MS) return { skip: 'tooLong' }
  const uid = item.iCalUID || item.id
  if (!uid) return { skip: 'other' }

  const title = capText(
    stripInvisibleFormatting(item.summary ?? ''),
    IMPORTED_EVENT_LIMITS.titleLength,
  )
  const rawPlace = capText(
    stripInvisibleFormatting(item.location ?? ''),
    IMPORTED_EVENT_LIMITS.whereLength,
  )
  const location = rawPlace && !isMeetingLocation(rawPlace) ? rawPlace : ''
  // Kept when its location reads as a town Solara may search for, or when it is one of
  // the person's activities (whose place they can set by hand).
  if (!googleLocationQueries(location).length && !matchActivity(title, activities)) {
    return { skip: 'noPlace' }
  }

  const zone = [item.start.timeZone, calendarTimeZone].find(
    (z): z is string => !!z && isIanaTimeZone(z),
  )
  const original = item.recurringEventId ? item.originalStartTime?.dateTime : undefined
  const originalMs = original ? Date.parse(original) : NaN
  return {
    event: {
      uid,
      // The same form as an .ics occurrence's RECURRENCE-ID, so the same event imported
      // from a file has the same key (and is not shown twice).
      recurrenceId: Number.isNaN(originalMs) ? null : new Date(originalMs).toISOString(),
      title,
      start,
      end,
      timeZone: zone ?? fallbackTimeZone,
      location: location || null,
      geo: null,
      url: null,
    },
  }
}

// ---- The connection (which calendars) -------------------------------------------------

/**
 * Where the account's Google Calendar connection lives: Firestore, or memory in the
 * harness (CalendarLinkStore in lib/calendar-events.ts, REVIEW6 L4).
 */
export type GoogleLinkStore = CalendarLinkStore<GoogleCalendarLink>

export const firestoreGoogleLinkStore: GoogleLinkStore = firestoreCalendarLinkStore(
  GOOGLE_CALENDAR_LINK_DOC,
  parseGoogleCalendarLink,
)

/**
 * PURE. The person's calendars as choices, the main one first and named by the app (its
 * Google id is their email address, which is not stored: 'primary' stands for it).
 */
export function calendarChoices(list: readonly CalendarListEntry[]): GoogleCalendarChoice[] {
  const cap = (name: string) => capText(name, GOOGLE_EVENT_LIMITS.calendarNameLength)
  const primary = list.filter(c => c.primary).map(() => ({ id: 'primary', name: '' }))
  const others = list
    .filter(c => !c.primary && c.id.length <= GOOGLE_EVENT_LIMITS.calendarIdLength)
    .map(c => ({ id: c.id, name: cap(stripInvisibleFormatting(c.name)) || 'Calendar' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...(primary.length ? primary.slice(0, 1) : [{ id: 'primary', name: '' }]), ...others]
}

// ---- A refresh -------------------------------------------------------------------------

export interface SyncContext extends StoreContext {
  link: GoogleCalendarLink
  api: GoogleCalendarApi
  /** A token for GOOGLE_EVENTS_SCOPE. */
  token: string
  activities: readonly Pick<Activity, 'id' | 'name'>[]
}

/**
 * Reads the chosen calendars' events for the next GOOGLE_EVENT_LIMITS.windowDays days and
 * makes the stored `google` events match (storeCalendarEvents in lib/calendar-events.ts).
 * Null when `connected` says the connection is gone or changed, before anything is
 * written. Throws Google's errors (an auth problem: authProblem).
 */
export async function syncGoogleEvents(context: SyncContext): Promise<SyncOutcome | null> {
  const { link, api, token, home, activities, nowMs } = context
  const timeMin = new Date(nowMs)
  const timeMax = new Date(nowMs + GOOGLE_EVENT_LIMITS.windowDays * 86_400_000)
  const fallbackTimeZone = resolveTimeZone(home.timezone)
  const read = emptyRead()

  context.onProgress?.('Reading your Google Calendar…')
  for (const calendar of link.calendars) {
    let pageToken: string | undefined
    for (let page = 0; page < GOOGLE_EVENT_LIMITS.maxPagesPerCalendar; page++) {
      const answer = await api.listEvents(token, calendar.id, timeMin, timeMax, {
        pageToken,
        pageSize: GOOGLE_EVENT_LIMITS.pageSize,
      })
      if (!answer) {
        read.missing.push(calendar)
        break
      }
      for (const raw of answer.items) {
        const parsed = parseGoogleEvent(raw, {
          calendarTimeZone: answer.timeZone,
          fallbackTimeZone,
          activities,
          nowMs,
        })
        // The same event on two chosen calendars (an invitation, a shared calendar) once.
        if ('skip' in parsed) read.skipped[parsed.skip] += 1
        else await addFound(read, 'google', parsed.event)
      }
      pageToken = answer.nextPageToken
      if (!pageToken) break
    }
  }

  return storeCalendarEvents('google', read, {
    ...context,
    maxEventsPerSync: GOOGLE_EVENT_LIMITS.maxEventsPerSync,
    queriesFor: googleLocationQueries,
  })
}

/**
 * A refresh of `link`, the connection as it was when it started: syncGoogleEvents, then
 * the new `syncedAt`. A disconnect or a new calendar choice on another device wins
 * (refreshCalendarLink in lib/calendar-events.ts). Null when it stopped for that reason
 * (REVIEW6 L4).
 */
export async function refreshGoogleEvents(
  context: SyncContext & { linkStore: Pick<GoogleLinkStore, 'read' | 'update'> },
): Promise<SyncOutcome | null> {
  return refreshCalendarLink(context, connected => syncGoogleEvents({ ...context, connected }))
}

/**
 * Disconnects Google Calendar: the connection goes first, so no refresh on any device can
 * store events from then on (the rules refuse them), then every stored Google event, then
 * Solara's grant at Google. True when Google confirmed the grant ended.
 */
export async function disconnectGoogleCalendar({
  uid,
  linkStore,
  store,
  api,
}: {
  uid: string
  linkStore: Pick<GoogleLinkStore, 'remove'>
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>
  api: Pick<GoogleCalendarApi, 'revoke'>
}): Promise<boolean> {
  await disconnectCalendar({ uid, source: 'google', linkStore, store })
  return api.revoke().catch(() => false)
}

/**
 * Removes every stored Google event: after a disconnect, and whenever a device finds
 * Google events with no connection (a disconnect whose removal stopped halfway).
 */
export function removeGoogleEvents(
  uid: string,
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>,
): Promise<number> {
  return removeSourceEvents(uid, 'google', store)
}

/** PURE. What a refresh did, in a sentence or two. */
export function syncSummary(outcome: SyncOutcome): string {
  return calendarSyncSummary(outcome, {
    service: 'Google Calendar',
    windowDays: GOOGLE_EVENT_LIMITS.windowDays,
  })
}

/** True when a refresh is due by itself (the app is open and a token is in memory). */
export function refreshDue(link: GoogleCalendarLink, nowMs: number): boolean {
  return refreshDueAfter(link, nowMs, GOOGLE_EVENT_LIMITS.autoRefreshMinutes)
}
