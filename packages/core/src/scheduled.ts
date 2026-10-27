// Scheduled activities: Google Calendar events Solara created for a lower-UV window.
//
// Each one is stored as `users/{uid}/scheduled/{eventId}` so it shows at once on every
// device, and every event Solara creates is tagged with private extended properties
// (SOLARA_EVENT_TAG) so Solara can later look up only its own events, never anything
// else on the calendar. firestore.rules repeats the field list and caps below;
// lib/firestore-rules.test.ts fails when the two drift.

import * as v from 'valibot'
import { record } from './schema'

/** Storage caps, mirrored by firestore.rules. */
export const SCHEDULED_LIMITS = Object.freeze({
  /** Google event ids are 5-1024 characters. */
  eventIdLength: 1024,
  activityIdLength: 64,
  titleLength: 200,
  iconLength: 16,
  timestampLength: 40,
  timezoneLength: 64,
  linkLength: 2048,
  /** Most records one list query may return (rules check `request.query.limit`). */
  listLimit: 100,
})

/** Fields of a stored scheduled activity, in the order firestore.rules lists them. */
export const SCHEDULED_FIELDS = Object.freeze([
  'eventId',
  'calendarId',
  'activityId',
  'title',
  'icon',
  'start',
  'end',
  'timeZone',
  'htmlLink',
  'createdAt',
  'updatedAt',
] as const)

/**
 * Days a record is kept after its event ends. The app prunes older records when the
 * account opens, and Firestore's TTL policy on SCHEDULED_TTL_FIELD deletes them even if
 * the account never comes back (infra/firestore-ttl.sh).
 */
export const SCHEDULED_RETENTION_DAYS = 30
/**
 * The Firestore Timestamp a stored record expires at: its end plus the retention. It is
 * storage bookkeeping, written on save and checked by firestore.rules, and not part of
 * the parsed record.
 */
export const SCHEDULED_TTL_FIELD = 'expireAt'
/** The latest expiry the rules accept, in days from the write, so every record expires. */
export const SCHEDULED_MAX_TTL_DAYS = 400

/** When a stored record expires: its event's end plus SCHEDULED_RETENTION_DAYS. */
export function scheduledExpiry(scheduled: { end: string }): Date {
  return new Date(Date.parse(scheduled.end) + SCHEDULED_RETENTION_DAYS * 86_400_000)
}

/** Only the primary calendar is used today; the field leaves room for others. */
export const SCHEDULED_CALENDAR_IDS = Object.freeze(['primary'] as const)

/**
 * Private extended properties on every event Solara creates. Google lets an app
 * filter on them (`privateExtendedProperty=solara=1`), and other apps cannot see them.
 */
export const SOLARA_EVENT_TAG = Object.freeze({ key: 'solara', value: '1' })
export const SOLARA_ACTIVITY_PROPERTY = 'solaraActivityId'
export const SOLARA_DATE_PROPERTY = 'solaraWindowDate'

/** Google event ids use base32hex; `_` appears in instance ids. */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/
/** Event links Google returns, and the only links Solara stores or renders. */
export const EVENT_LINK_PATTERN = /^https:\/\/(?:www\.google\.com|calendar\.google\.com)\//
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/

/** An instant written by `Date.prototype.toISOString`. */
const isoInstant = v.pipe(
  v.string(),
  v.maxLength(SCHEDULED_LIMITS.timestampLength),
  v.check(value => !Number.isNaN(Date.parse(value))),
)

export const SCHEDULED_SHAPE = {
  eventId: v.pipe(v.string(), v.regex(EVENT_ID_PATTERN)),
  calendarId: v.picklist(SCHEDULED_CALENDAR_IDS),
  activityId: v.pipe(v.string(), v.minLength(1), v.maxLength(SCHEDULED_LIMITS.activityIdLength)),
  title: v.pipe(v.string(), v.maxLength(SCHEDULED_LIMITS.titleLength)),
  icon: v.pipe(v.string(), v.maxLength(SCHEDULED_LIMITS.iconLength)),
  start: isoInstant,
  end: isoInstant,
  timeZone: v.pipe(
    v.string(),
    v.maxLength(SCHEDULED_LIMITS.timezoneLength),
    v.regex(TIMEZONE_PATTERN),
  ),
  htmlLink: v.pipe(
    v.string(),
    v.maxLength(SCHEDULED_LIMITS.linkLength),
    v.regex(EVENT_LINK_PATTERN),
  ),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}

export const ScheduledActivitySchema = v.pipe(
  record(SCHEDULED_SHAPE),
  v.check(
    scheduled => Date.parse(scheduled.end) > Date.parse(scheduled.start),
    'end must be after start',
  ),
)
export type ScheduledActivity = v.InferOutput<typeof ScheduledActivitySchema>

/** A stored record, or null when it does not match the schema (it is then ignored). */
export function parseScheduledActivity(raw: unknown): ScheduledActivity | null {
  const parsed = v.safeParse(ScheduledActivitySchema, raw)
  return parsed.success ? parsed.output : null
}

/** Cut text to a cap without splitting a surrogate pair (emoji). */
export function capText(value: string, max: number): string {
  const chars = Array.from(value.trim())
  let out = ''
  for (const char of chars) {
    if (out.length + char.length > max) break
    out += char
  }
  return out
}
