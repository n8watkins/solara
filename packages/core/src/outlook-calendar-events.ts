// Events already in Outlook (docs/integrations/OUTLOOK.md, ROADMAP item 23): the Microsoft
// counterpart of events from Google Calendar (google-calendar-events.ts). The app reads
// the person's upcoming events with Microsoft Graph's `Calendars.ReadBasic`, in the
// browser, and keeps the ones with a place (or that match one of their activities) next
// to imported events (`source: 'outlook'` in users/{uid}/events). Nothing is read on the
// server and no Microsoft token is stored anywhere.
//
// Which calendars the person chose lives in users/{uid}/meta/outlookCalendar (parsed by
// `parseOutlookCalendarLink` below), so every device refreshes the same ones and turning
// the feature off on one device turns it off on all of them. firestore.rules repeats the
// fields and caps below; lib/firestore-rules.test.ts fails when the two drift.

import * as v from 'valibot'
import { record } from './schema'

/**
 * Read events (except their body, attachments and extensions) and list calendars, on the
 * person's own mailbox: the least privileged delegated permission for both Graph calls,
 * with no admin consent. No `offline_access`, so Microsoft never issues a refresh token.
 */
export const OUTLOOK_EVENTS_SCOPE = 'https://graph.microsoft.com/Calendars.ReadBasic'

/**
 * The calendar every connection starts with: the person's default calendar, read through
 * /me/calendar so its Graph id (which carries the mailbox's address) is never stored.
 */
export const OUTLOOK_DEFAULT_CALENDAR_ID = 'default'

/** Defaults, owner may change (docs/ROADMAP.md decisions, 2026-10-28; as for Google). */
export const OUTLOOK_EVENT_LIMITS = Object.freeze({
  /** Events are read from now to this many days ahead. */
  windowDays: 30,
  /** Most calendars one account may read events from. */
  maxCalendars: 10,
  /**
   * Graph calendar ids are base64 strings of about 150 characters for personal and work
   * accounts in Microsoft's examples; the cap leaves room for longer ones.
   */
  calendarIdLength: 512,
  calendarNameLength: 120,
  timestampLength: 40,
  /** Most events one refresh keeps (the soonest), well under the 1,000-event cap. */
  maxEventsPerSync: 200,
  /** Events asked for per calendarView page (`$top`); Graph's own default is smaller. */
  pageSize: 100,
  /** Pages read per calendar per refresh, so at most 1,000 occurrences each. */
  maxPagesPerCalendar: 10,
  /** A refresh runs by itself while the app is open at most this often. */
  autoRefreshMinutes: 30,
})

/** users/{uid}/meta/{OUTLOOK_CALENDAR_LINK_DOC}. */
export const OUTLOOK_CALENDAR_LINK_DOC = 'outlookCalendar'

/** Fields of the stored connection, in the order firestore.rules lists them. */
export const OUTLOOK_CALENDAR_LINK_FIELDS = Object.freeze([
  'calendars',
  'connectedAt',
  'syncedAt',
] as const)

/** Fields of one chosen calendar. */
export const OUTLOOK_CALENDAR_CHOICE_FIELDS = Object.freeze(['id', 'name'] as const)

const isoInstant = v.pipe(
  v.string(),
  v.maxLength(OUTLOOK_EVENT_LIMITS.timestampLength),
  v.check(value => !Number.isNaN(Date.parse(value))),
)

export const OutlookCalendarChoiceSchema = record({
  /** Graph's calendar id ('default' for the default calendar). */
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(OUTLOOK_EVENT_LIMITS.calendarIdLength)),
  /** The name shown ('' for the default calendar, which the app names itself). */
  name: v.pipe(v.string(), v.maxLength(OUTLOOK_EVENT_LIMITS.calendarNameLength)),
})
export type OutlookCalendarChoice = v.InferOutput<typeof OutlookCalendarChoiceSchema>

export const OutlookCalendarLinkSchema = record({
  calendars: v.pipe(
    v.array(OutlookCalendarChoiceSchema),
    v.minLength(1),
    v.maxLength(OUTLOOK_EVENT_LIMITS.maxCalendars),
  ),
  connectedAt: isoInstant,
  /** The last refresh that finished ('' before the first). */
  syncedAt: v.union([v.literal(''), isoInstant]),
})
export type OutlookCalendarLink = v.InferOutput<typeof OutlookCalendarLinkSchema>

/** A stored connection, or null when there is none or it does not match the schema. */
export function parseOutlookCalendarLink(raw: unknown): OutlookCalendarLink | null {
  const parsed = v.safeParse(OutlookCalendarLinkSchema, raw)
  return parsed.success ? parsed.output : null
}

/** A new connection to the default calendar, made at `now` (ISO). */
export function newOutlookCalendarLink(now: string): OutlookCalendarLink {
  return {
    calendars: [{ id: OUTLOOK_DEFAULT_CALENDAR_ID, name: '' }],
    connectedAt: now,
    syncedAt: '',
  }
}
