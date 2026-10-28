// Events already in Outlook (docs/integrations/OUTLOOK.md, ROADMAP item 23): the app's
// side, which is all of it. With the person's consent the browser reads their upcoming
// events from Microsoft Graph with `Calendars.ReadBasic` (signed in through
// lib/microsoft-auth.ts), keeps those with an address, a place picked in Outlook, or a
// title that matches one of their activities, and stores them next to imported events
// (`source: 'outlook'`), with the same refresh, duplicate and place rules as Google
// Calendar events (lib/calendar-events.ts). The token stays in memory, so events refresh
// only while Solara is open. Only the lazily loaded Outlook panel imports this module.
import { capText } from '@solara/core'
import {
  IMPORTED_EVENT_LIMITS,
  OUTLOOK_CALENDAR_LINK_DOC,
  OUTLOOK_DEFAULT_CALENDAR_ID,
  OUTLOOK_EVENT_LIMITS,
  OUTLOOK_EVENTS_SCOPE,
  instantInZone,
  isIanaTimeZone,
  matchActivity,
  parseOutlookCalendarLink,
  stripInvisibleFormatting,
  windowsZoneToIana,
  type OutlookCalendarChoice,
  type OutlookCalendarLink,
  type ParsedIcsEvent,
} from '@solara/core/event-import'
import * as v from 'valibot'
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
import {
  MicrosoftAuthError,
  forgetMicrosoftToken,
  microsoftAuth,
  type MicrosoftAuthReason,
} from './microsoft-auth'
import { resolveTimeZone } from './time'

export type { OutlookCalendarChoice, OutlookCalendarLink, SyncOutcome }
export { OUTLOOK_EVENTS_SCOPE }

/** Microsoft Graph's origin (Content-Security-Policy `connect-src`, lib/csp.mts). */
export const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const GRAPH = `${GRAPH_ORIGIN}/v1.0`

/**
 * The event fields Solara asks Graph for. Never `body`, `bodyPreview`, `attendees`,
 * `organizer`, `onlineMeeting` or `onlineMeetingUrl`: notes, guests and join links (which
 * can carry passcodes) never reach the browser. `Calendars.ReadBasic` withholds the body,
 * attachments and extensions anyway.
 */
export const OUTLOOK_EVENT_FIELDS =
  'subject,start,end,isAllDay,isCancelled,isOnlineMeeting,location,responseStatus,iCalUId,type,originalStart,originalStartTimeZone'

/**
 * The calendar fields Solara asks for. `owner` (the address of whoever added the
 * calendar) is compared in memory with the default calendar's to leave out calendars
 * other people share, and never stored.
 */
export const OUTLOOK_CALENDAR_FIELDS = 'id,name,isDefaultCalendar,owner'

/** Personal accounts: remove Solara's permission here (docs/integrations/OUTLOOK.md). */
export const MICROSOFT_PERSONAL_CONSENT_URL = 'https://account.live.com/consent/Manage'
/** Work or school accounts: My Apps, then the app's "Revoke Permissions". */
export const MICROSOFT_WORK_APPS_URL = 'https://myapplications.microsoft.com/'

// ---- Microsoft's side, swappable in the UI harness -------------------------------------

/** One of the person's calendars, as Graph names it. */
export interface OutlookCalendarEntry {
  id: string
  name: string
  isDefault: boolean
}

/** One page of a calendar's events, as Graph sends it (parsed by parseOutlookEvent). */
export interface OutlookEventsPage {
  items: unknown[]
  /** Graph's `@odata.nextLink`, followed only when it is a Graph address. */
  nextLink?: string
}

/** What the feature needs from Microsoft: Graph and lib/microsoft-auth.ts, or a fake. */
export interface OutlookCalendarApi {
  /** True when an unexpired token is in memory (no popup needed). */
  hasToken(): boolean
  /** A token; `interactive` opens Microsoft's sign-in popup, which needs a click. */
  requestToken(options: { interactive: boolean }): Promise<string>
  listCalendars(token: string): Promise<OutlookCalendarEntry[]>
  /**
   * One page of events on `calendarId` ('default' for the default calendar) between
   * `start` and `end`, or the page at `nextLink`. Null when the calendar is gone or no
   * longer readable (403 or 404).
   */
  listEvents(
    token: string,
    calendarId: string,
    start: Date,
    end: Date,
    nextLink?: string,
  ): Promise<OutlookEventsPage | null>
  /** Forgets the token (a disconnect, sign-out or account switch). */
  forget(): void
}

/** Graph is busy (429 twice): the person tries again shortly. */
export class OutlookBusyError extends Error {
  constructor() {
    super('Outlook is busy')
    this.name = 'OutlookBusyError'
  }
}

/** The longest Retry-After Solara waits for once before saying Outlook is busy. */
const MAX_RETRY_AFTER_MS = 30_000

/** Waits `ms`; swappable in tests. */
let pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
/** For tests: replaces the wait before a retry. */
export function setRetryPause(wait: (ms: number) => Promise<void>) {
  pause = wait
}

/**
 * A GET to Graph with the token. A 401 forgets the token and throws MicrosoftAuthError;
 * a 429 waits for Retry-After once, then throws OutlookBusyError.
 */
async function graphGet(token: string, url: string, forget: () => void): Promise<Response> {
  if (!url.startsWith(`${GRAPH}/`)) throw new Error('Not a Microsoft Graph address')
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401) {
      forget()
      throw new MicrosoftAuthError('no_token')
    }
    if (response.status !== 429) return response
    if (attempt > 0) throw new OutlookBusyError()
    const seconds = Number(response.headers.get('Retry-After'))
    await pause(Math.min(MAX_RETRY_AFTER_MS, (Number.isFinite(seconds) ? seconds : 5) * 1000))
  }
}

const calendarListSchema = v.looseObject({
  value: v.optional(v.array(v.unknown())),
  '@odata.nextLink': v.optional(v.string()),
})

const calendarEntrySchema = v.looseObject({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.optional(v.string()),
  isDefaultCalendar: v.optional(v.boolean()),
  // Not in Graph v1.0's documented calendar resource today; honoured if it ever appears.
  isSharedWithMe: v.optional(v.boolean()),
  owner: v.optional(v.looseObject({ address: v.optional(v.string()) })),
})

/**
 * PURE. The person's own calendars from Graph's calendar list: those added by the same
 * address as the default calendar (or, when Graph names no owner, all of them), without
 * calendars other people share, which `Calendars.ReadBasic` cannot read.
 */
export function ownCalendars(items: readonly unknown[]): OutlookCalendarEntry[] {
  const entries = items.flatMap(raw => {
    const parsed = v.safeParse(calendarEntrySchema, raw)
    return parsed.success ? [parsed.output] : []
  })
  const ownerOf = (entry: (typeof entries)[number]) => entry.owner?.address?.trim().toLowerCase()
  const defaultOwner = entries.find(e => e.isDefaultCalendar)
  const me = defaultOwner && ownerOf(defaultOwner)
  return entries
    .filter(e => e.isSharedWithMe !== true)
    .filter(e => !me || !ownerOf(e) || ownerOf(e) === me)
    .map(e => ({ id: e.id, name: e.name ?? '', isDefault: e.isDefaultCalendar === true }))
}

const eventsPageSchema = v.looseObject({
  value: v.optional(v.array(v.unknown())),
  '@odata.nextLink': v.optional(v.string()),
})

/** Graph's calendarView address for one calendar (`default`: /me/calendar). */
export function calendarViewUrl(calendarId: string, start: Date, end: Date): string {
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: OUTLOOK_EVENT_FIELDS,
    $top: String(OUTLOOK_EVENT_LIMITS.pageSize),
  })
  const path =
    calendarId === OUTLOOK_DEFAULT_CALENDAR_ID
      ? '/me/calendar/calendarView'
      : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
  return `${GRAPH}${path}?${params}`
}

/** Microsoft Graph and lib/microsoft-auth.ts, as the app uses them. */
export const outlookCalendarApi: OutlookCalendarApi = {
  hasToken: () => microsoftAuth().hasToken(OUTLOOK_EVENTS_SCOPE),
  requestToken: options => microsoftAuth().requestToken(OUTLOOK_EVENTS_SCOPE, options),
  async listCalendars(token) {
    const items: unknown[] = []
    let url: string | undefined =
      `${GRAPH}/me/calendars?${new URLSearchParams({ $select: OUTLOOK_CALENDAR_FIELDS, $top: '100' })}`
    // At most 3 pages (300 calendars): far more than anyone chooses from.
    for (let page = 0; url && page < 3; page++) {
      const response = await graphGet(token, url, forgetMicrosoftToken)
      if (!response.ok) throw new Error(`calendar list failed: ${response.status}`)
      const parsed = v.safeParse(calendarListSchema, await response.json())
      if (!parsed.success) throw new Error('Unexpected Microsoft Graph response')
      items.push(...(parsed.output.value ?? []))
      url = parsed.output['@odata.nextLink']
    }
    return ownCalendars(items)
  },
  async listEvents(token, calendarId, start, end, nextLink) {
    const url = nextLink ?? calendarViewUrl(calendarId, start, end)
    const response = await graphGet(token, url, forgetMicrosoftToken)
    if (response.status === 403 || response.status === 404) return null
    if (!response.ok) throw new Error(`event list failed: ${response.status}`)
    const parsed = v.safeParse(eventsPageSchema, await response.json())
    if (!parsed.success) throw new Error('Unexpected Microsoft Graph response')
    const next = parsed.output['@odata.nextLink']
    return {
      items: parsed.output.value ?? [],
      nextLink: next?.startsWith(`${GRAPH}/`) ? next : undefined,
    }
  },
  forget: forgetMicrosoftToken,
}

/**
 * What a failed Microsoft call means for the person, or null for anything else (a network
 * failure, Graph being down): `dismissed` when they closed or cancelled the sign-in
 * themselves, which is not an error.
 */
export function outlookAuthProblem(error: unknown): { reason: MicrosoftAuthReason } | null {
  if (!(error instanceof Error) || error.name !== 'CalendarAuthError') return null
  return { reason: (error as Error & { reason?: string }).reason ?? 'no_token' }
}

// ---- Reading one Outlook event ---------------------------------------------------------

/** Why an Outlook event is not shown. */
export type OutlookSkip = CalendarSkip

const timeSchema = v.looseObject({
  dateTime: v.optional(v.string()),
  timeZone: v.optional(v.string()),
})

const outlookEventSchema = v.looseObject({
  id: v.optional(v.string()),
  iCalUId: v.optional(v.nullable(v.string())),
  // Microsoft documents Calendars.ReadBasic as withholding only "properties such as body,
  // attachments, and extensions"; every other field is optional here, so an event read
  // without a subject or a location is skipped or kept by its other fields, not dropped.
  subject: v.optional(v.nullable(v.string())),
  start: v.optional(v.nullable(timeSchema)),
  end: v.optional(v.nullable(timeSchema)),
  isAllDay: v.optional(v.nullable(v.boolean())),
  isCancelled: v.optional(v.nullable(v.boolean())),
  isOnlineMeeting: v.optional(v.nullable(v.boolean())),
  type: v.optional(v.nullable(v.string())),
  originalStart: v.optional(v.nullable(v.string())),
  originalStartTimeZone: v.optional(v.nullable(v.string())),
  responseStatus: v.optional(v.nullable(v.looseObject({ response: v.optional(v.string()) }))),
  location: v.optional(
    v.nullable(
      v.looseObject({
        displayName: v.optional(v.nullable(v.string())),
        locationType: v.optional(v.nullable(v.string())),
        coordinates: v.optional(
          v.nullable(
            v.looseObject({
              latitude: v.optional(v.nullable(v.number())),
              longitude: v.optional(v.nullable(v.number())),
            }),
          ),
        ),
      }),
    ),
  ),
})

/** Graph's names for "UTC", the zone of `start` and `end` without a Prefer header. */
const UTC_NAMES = new Set(['utc', 'etc/utc', 'coordinated universal time', 'gmt', 'etc/gmt'])

/** An IANA zone for a Graph zone name (IANA or Windows), or null for an unknown one. */
export function outlookZone(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  if (UTC_NAMES.has(trimmed.toLowerCase())) return 'UTC'
  if (isIanaTimeZone(trimmed)) return trimmed
  // "tzone://Microsoft/Custom" (a custom zone from desktop Outlook) is not mappable.
  return windowsZoneToIana(trimmed)
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

/**
 * PURE. Epoch ms of a Graph dateTimeTimeZone. Without a `Prefer: outlook.timezone` header,
 * Graph sends UTC wall-clock times with no offset ("2026-06-16T19:00:00.0000000");
 * another zone, if Graph ever sends one, is read as that zone's wall clock. NaN when it
 * cannot be read.
 */
export function graphInstant(
  time: { dateTime?: string; timeZone?: string } | null | undefined,
): number {
  const text = time?.dateTime?.trim()
  if (!text) return NaN
  if (/(?:[zZ]|[+-]\d\d:\d\d)$/.test(text)) return Date.parse(text)
  const match = LOCAL_TIME.exec(text)
  if (!match) return NaN
  const zone = time?.timeZone ? outlookZone(time.timeZone) : 'UTC'
  if (!zone) return NaN
  const [, year, month, day, hour, minute, second] = match
  const local = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? 0),
  }
  return zone === 'UTC'
    ? Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
    : instantInZone(local, zone)
}

/** A video meeting's name as Outlook writes it in the location ("Microsoft Teams Meeting"). */
const MEETING_PROVIDER =
  /^(microsoft teams( meeting)?|teams( meeting)?|skype( for business)?( meeting)?|zoom( meeting)?|google meet|webex( meeting)?|online meeting)$/i

/** Location types that are never a place to forecast: an office room, a home, a workplace. */
const PRIVATE_LOCATION_TYPES = new Set(['conferenceRoom', 'homeAddress', 'businessAddress'])

export interface OutlookEventContext {
  /** The person's zone, when the event names none Solara can read. */
  fallbackTimeZone: string
  activities: readonly { id: string; name: string }[]
  nowMs: number
}

/**
 * PURE. An Outlook event (a calendarView item) as the importer's event, or why it is
 * skipped. Kept: timed events that are not cancelled, have not ended, are not declined,
 * last at most a week, and have a location that reads as a town (calendarLocationQueries),
 * a place picked in Outlook (its coordinates), or a title matching one of the person's
 * activities. Links, dial-in details, meeting names, office rooms and homes are never kept
 * as the location.
 */
export function parseOutlookEvent(
  raw: unknown,
  { fallbackTimeZone, activities, nowMs }: OutlookEventContext,
): { event: ParsedIcsEvent } | { skip: OutlookSkip } {
  const parsed = v.safeParse(outlookEventSchema, raw)
  if (!parsed.success) return { skip: 'other' }
  const item = parsed.output
  if (item.isCancelled || item.type === 'seriesMaster') return { skip: 'other' }
  if (item.isAllDay) return { skip: 'allDay' }
  if (item.responseStatus?.response === 'declined') return { skip: 'declined' }
  const start = graphInstant(item.start)
  const end = graphInstant(item.end)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end <= nowMs) {
    return { skip: 'other' }
  }
  if (end - start > MAX_EVENT_MS) return { skip: 'tooLong' }
  const uid = item.iCalUId || item.id
  if (!uid) return { skip: 'other' }

  const title = capText(
    stripInvisibleFormatting(item.subject ?? ''),
    IMPORTED_EVENT_LIMITS.titleLength,
  )
  const place = item.location
  const privatePlace = !!place?.locationType && PRIVATE_LOCATION_TYPES.has(place.locationType)
  const rawPlace = capText(
    stripInvisibleFormatting(place?.displayName ?? ''),
    IMPORTED_EVENT_LIMITS.whereLength,
  )
  const location =
    rawPlace && !privatePlace && !isMeetingLocation(rawPlace) && !MEETING_PROVIDER.test(rawPlace)
      ? rawPlace
      : ''
  const lat = place?.coordinates?.latitude
  const lon = place?.coordinates?.longitude
  const geo =
    !privatePlace &&
    !(rawPlace && !location) &&
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
      ? { lat, lon }
      : null
  if (!geo && !calendarLocationQueries(location).length && !matchActivity(title, activities)) {
    return { skip: 'noPlace' }
  }

  const original =
    item.type === 'occurrence' || item.type === 'exception' ? item.originalStart : undefined
  const originalMs = original ? Date.parse(original) : NaN
  return {
    event: {
      uid,
      // The same form as an .ics occurrence's RECURRENCE-ID, so the same occurrence read
      // from a file or another calendar has the same key.
      recurrenceId: Number.isNaN(originalMs) ? null : new Date(originalMs).toISOString(),
      title,
      start,
      end,
      timeZone: outlookZone(item.originalStartTimeZone) ?? fallbackTimeZone,
      location: location || null,
      geo,
      url: null,
    },
  }
}

// ---- The connection (which calendars) -------------------------------------------------

/** Where the account's Outlook connection lives (CalendarLinkStore, REVIEW6 L4). */
export type OutlookLinkStore = CalendarLinkStore<OutlookCalendarLink>

export const firestoreOutlookLinkStore: OutlookLinkStore = firestoreCalendarLinkStore(
  OUTLOOK_CALENDAR_LINK_DOC,
  parseOutlookCalendarLink,
)

/**
 * PURE. The person's calendars as choices, the default one first and named by the app
 * (stored as 'default', so its Graph id is never stored), then the others by name.
 */
export function outlookCalendarChoices(
  list: readonly OutlookCalendarEntry[],
): OutlookCalendarChoice[] {
  const cap = (name: string) => capText(name, OUTLOOK_EVENT_LIMITS.calendarNameLength)
  const others = list
    .filter(c => !c.isDefault && c.id.length <= OUTLOOK_EVENT_LIMITS.calendarIdLength)
    .map(c => ({ id: c.id, name: cap(stripInvisibleFormatting(c.name)) || 'Calendar' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [{ id: OUTLOOK_DEFAULT_CALENDAR_ID, name: '' }, ...others]
}

// ---- A refresh -------------------------------------------------------------------------

export interface OutlookSyncContext extends StoreContext {
  link: OutlookCalendarLink
  api: OutlookCalendarApi
  token: string
}

/**
 * Reads the chosen calendars' events for the next OUTLOOK_EVENT_LIMITS.windowDays days
 * (recurring events arrive expanded) and makes the stored `outlook` events match
 * (storeCalendarEvents in lib/calendar-events.ts). Null when `connected` says the
 * connection is gone or changed, before anything is written. Throws Microsoft's errors (an
 * auth problem: outlookAuthProblem; Graph busy: OutlookBusyError).
 */
export async function syncOutlookEvents(context: OutlookSyncContext): Promise<SyncOutcome | null> {
  const { link, api, token, home, activities, nowMs } = context
  const start = new Date(nowMs)
  const end = new Date(nowMs + OUTLOOK_EVENT_LIMITS.windowDays * 86_400_000)
  const fallbackTimeZone = resolveTimeZone(home.timezone)
  const read = emptyRead()

  context.onProgress?.('Reading your Outlook calendar…')
  for (const calendar of link.calendars) {
    let nextLink: string | undefined
    for (let page = 0; page < OUTLOOK_EVENT_LIMITS.maxPagesPerCalendar; page++) {
      const answer = await api.listEvents(token, calendar.id, start, end, nextLink)
      if (!answer) {
        read.missing.push(calendar)
        break
      }
      for (const raw of answer.items) {
        const parsed = parseOutlookEvent(raw, { fallbackTimeZone, activities, nowMs })
        // The same event on two chosen calendars (an invitation, a copy) once.
        if ('skip' in parsed) read.skipped[parsed.skip] += 1
        else await addFound(read, 'outlook', parsed.event)
      }
      nextLink = answer.nextLink
      if (!nextLink) break
    }
  }

  return storeCalendarEvents('outlook', read, {
    ...context,
    maxEventsPerSync: OUTLOOK_EVENT_LIMITS.maxEventsPerSync,
  })
}

/**
 * A refresh of `link`, the connection as it was when it started: syncOutlookEvents, then
 * the new `syncedAt`; a disconnect or a new calendar choice on another device wins
 * (refreshCalendarLink, REVIEW6 L4). Null when it stopped for that reason.
 */
export function refreshOutlookEvents(
  context: OutlookSyncContext & { linkStore: Pick<OutlookLinkStore, 'read' | 'update'> },
): Promise<SyncOutcome | null> {
  return refreshCalendarLink(context, connected => syncOutlookEvents({ ...context, connected }))
}

/**
 * Disconnects Outlook: the connection goes first, so no refresh on any device can store
 * events from then on (the rules refuse them), then every stored Outlook event, then the
 * token in memory. A public client cannot revoke its own consent at Microsoft: the panel
 * links to the person's account pages for that (MICROSOFT_PERSONAL_CONSENT_URL,
 * MICROSOFT_WORK_APPS_URL). Without a refresh token, the remaining consent lets Solara
 * read nothing until the person signs in through the popup again.
 */
export async function disconnectOutlook({
  uid,
  linkStore,
  store,
  api,
}: {
  uid: string
  linkStore: Pick<OutlookLinkStore, 'remove'>
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>
  api: Pick<OutlookCalendarApi, 'forget'>
}): Promise<void> {
  api.forget()
  await disconnectCalendar({ uid, source: 'outlook', linkStore, store })
}

/** Removes every stored Outlook event (a disconnect that stopped halfway, anywhere). */
export function removeOutlookEvents(
  uid: string,
  store: Pick<EventsStore, 'sourceEvents' | 'remove'>,
): Promise<number> {
  return removeSourceEvents(uid, 'outlook', store)
}

/** PURE. What a refresh did, in a sentence or two. */
export function outlookSyncSummary(outcome: SyncOutcome): string {
  return calendarSyncSummary(outcome, {
    service: 'Outlook',
    windowDays: OUTLOOK_EVENT_LIMITS.windowDays,
  })
}

/** True when a refresh is due by itself (the app is open and a token is in memory). */
export function outlookRefreshDue(link: OutlookCalendarLink, nowMs: number): boolean {
  return refreshDueAfter(link, nowMs, OUTLOOK_EVENT_LIMITS.autoRefreshMinutes)
}
