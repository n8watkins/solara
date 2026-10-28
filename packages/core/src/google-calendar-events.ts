// Events already in Google Calendar (docs/integrations/EVENTS.md, phase 2b): the app reads
// the person's upcoming events with a read-only Calendar scope, in the browser, and keeps
// the ones with a place (or that match one of their activities) next to imported events
// (`source: 'google'` in users/{uid}/events), so they get the same UV card and the Pro
// heads-ups. Nothing is read on the server and no Google token is stored anywhere.
//
// Which calendars the person chose lives in users/{uid}/meta/googleCalendar (parsed by
// `parseGoogleCalendarLink` below), so every device refreshes the same ones and turning
// the feature off on one device turns it off on all of them. firestore.rules repeats the
// fields and caps below; lib/firestore-rules.test.ts fails when the two drift.

import * as v from 'valibot'
import { record } from './schema'

/**
 * Read-only access to events on every calendar the person can see (subscribed ones
 * included), requested only when they turn this on. Narrower than `calendar.readonly`,
 * which also reads calendar settings and sharing; separate from Scheduled's scopes.
 */
export const GOOGLE_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
/** The list of the person's calendars, requested only when they choose calendars. */
export const GOOGLE_CALENDAR_LIST_SCOPE =
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'

/** The calendar every connection starts with: the person's main calendar. */
export const PRIMARY_CALENDAR_ID = 'primary'

/** Defaults, owner may change (docs/ROADMAP.md decisions, 2026-10-28). */
export const GOOGLE_EVENT_LIMITS = Object.freeze({
  /** Events are read from now to this many days ahead. */
  windowDays: 30,
  /** Most calendars one account may read events from. */
  maxCalendars: 10,
  calendarIdLength: 256,
  calendarNameLength: 120,
  timestampLength: 40,
  /** Most events one refresh keeps (the soonest), well under the 1,000-event cap. */
  maxEventsPerSync: 200,
  /** Events per Calendar API page (Google's maximum is 2,500; 250 is its default cap). */
  pageSize: 250,
  /** Pages read per calendar per refresh. */
  maxPagesPerCalendar: 4,
  /** A refresh runs by itself while the app is open at most this often. */
  autoRefreshMinutes: 30,
})

/** users/{uid}/meta/{GOOGLE_CALENDAR_LINK_DOC}. */
export const GOOGLE_CALENDAR_LINK_DOC = 'googleCalendar'

/** Fields of the stored connection, in the order firestore.rules lists them. */
export const GOOGLE_CALENDAR_LINK_FIELDS = Object.freeze([
  'calendars',
  'connectedAt',
  'syncedAt',
] as const)

/** Fields of one chosen calendar. */
export const GOOGLE_CALENDAR_CHOICE_FIELDS = Object.freeze(['id', 'name'] as const)

const isoInstant = v.pipe(
  v.string(),
  v.maxLength(GOOGLE_EVENT_LIMITS.timestampLength),
  v.check(value => !Number.isNaN(Date.parse(value))),
)

export const GoogleCalendarChoiceSchema = record({
  /** Google's calendar id ('primary' for the main calendar). */
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(GOOGLE_EVENT_LIMITS.calendarIdLength)),
  /** The name shown ('' for the main calendar, which the app names itself). */
  name: v.pipe(v.string(), v.maxLength(GOOGLE_EVENT_LIMITS.calendarNameLength)),
})
export type GoogleCalendarChoice = v.InferOutput<typeof GoogleCalendarChoiceSchema>

export const GoogleCalendarLinkSchema = record({
  calendars: v.pipe(
    v.array(GoogleCalendarChoiceSchema),
    v.minLength(1),
    v.maxLength(GOOGLE_EVENT_LIMITS.maxCalendars),
  ),
  connectedAt: isoInstant,
  /** The last refresh that finished ('' before the first). */
  syncedAt: v.union([v.literal(''), isoInstant]),
})
export type GoogleCalendarLink = v.InferOutput<typeof GoogleCalendarLinkSchema>

/** A stored connection, or null when there is none or it does not match the schema. */
export function parseGoogleCalendarLink(raw: unknown): GoogleCalendarLink | null {
  const parsed = v.safeParse(GoogleCalendarLinkSchema, raw)
  return parsed.success ? parsed.output : null
}

/** A new connection to the main calendar, made at `now` (ISO). */
export function newGoogleCalendarLink(now: string): GoogleCalendarLink {
  return { calendars: [{ id: PRIMARY_CALENDAR_ID, name: '' }], connectedAt: now, syncedAt: '' }
}
