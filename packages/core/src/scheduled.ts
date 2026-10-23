// Scheduled activities: Google Calendar events Solara created for a lower-UV window.
//
// Each one is stored as `users/{uid}/scheduled/{eventId}` so it shows at once on every
// device, and every event Solara creates is tagged with private extended properties
// (SOLARA_EVENT_TAG) so Solara can later look up only its own events, never anything
// else on the calendar. firestore.rules repeats the field list and caps below;
// lib/firestore-rules.test.ts fails when the two drift.

import * as z from 'zod/mini'

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
const isoInstant = z.string().check(
  z.maxLength(SCHEDULED_LIMITS.timestampLength),
  z.refine(value => !Number.isNaN(Date.parse(value))),
)

export const SCHEDULED_SHAPE = {
  eventId: z.string().check(z.regex(EVENT_ID_PATTERN)),
  calendarId: z.enum(SCHEDULED_CALENDAR_IDS),
  activityId: z.string().check(z.minLength(1), z.maxLength(SCHEDULED_LIMITS.activityIdLength)),
  title: z.string().check(z.maxLength(SCHEDULED_LIMITS.titleLength)),
  icon: z.string().check(z.maxLength(SCHEDULED_LIMITS.iconLength)),
  start: isoInstant,
  end: isoInstant,
  timeZone: z
    .string()
    .check(z.maxLength(SCHEDULED_LIMITS.timezoneLength), z.regex(TIMEZONE_PATTERN)),
  htmlLink: z.string().check(z.maxLength(SCHEDULED_LIMITS.linkLength), z.regex(EVENT_LINK_PATTERN)),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}

export const ScheduledActivitySchema = z.object(SCHEDULED_SHAPE).check(
  z.refine(record => Date.parse(record.end) > Date.parse(record.start), {
    message: 'end must be after start',
  }),
)
export type ScheduledActivity = z.output<typeof ScheduledActivitySchema>

/** A stored record, or null when it does not match the schema (it is then ignored). */
export function parseScheduledActivity(raw: unknown): ScheduledActivity | null {
  const parsed = ScheduledActivitySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
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
