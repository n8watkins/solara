// Scheduled activities: the Google Calendar events Solara created, kept in Firestore
// (users/{uid}/scheduled/{eventId}) so every device shows them at once, and
// reconciled with Google when a token is available.
//
// The record schema lives in @solara/core (packages/core/src/scheduled.ts). This module
// holds the pure conversions and reconciliation (unit-tested) and the Firestore storage.
import {
  capText,
  EVENT_LINK_PATTERN,
  parseScheduledActivity,
  SCHEDULED_LIMITS,
  SOLARA_ACTIVITY_PROPERTY,
  type ScheduledActivity,
} from '@solara/core'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type { GoogleEvent } from './gcal'
import { isIsoDate, isValidTimeZone, zonedInstant, zonedNow } from './time'
import type { Activity, SafeActivityWindow } from './types'

export type { ScheduledActivity }

/** Records that ended longer ago than this are pruned. */
export const SCHEDULED_RETENTION_MS = 30 * 86_400_000
/** Minutes between the start times offered by "Change time". */
export const START_STEP_MINUTES = 15

// ---- Time --------------------------------------------------------------------------

/** Where a scheduled activity falls on the calendar of `timeZone`. */
export interface ScheduledSpan {
  /** The local date it starts on, YYYY-MM-DD. */
  date: string
  /** Start, in fractional hours since local midnight. */
  from: number
  /** End, in fractional hours since local midnight of `date` (at most 24). */
  to: number
}

/** PURE. The local date and hours of a scheduled activity in `timeZone`. */
export function scheduledSpan(item: ScheduledActivity, timeZone: string): ScheduledSpan {
  const startMs = Date.parse(item.start)
  const endMs = Date.parse(item.end)
  const start = zonedNow(timeZone, startMs)
  const from = start.hour + start.minute / 60
  const dayStart = zonedInstant(start.date, 0, timeZone)
  const to = Math.min(24, from + (endMs - startMs) / 3_600_000, (endMs - dayStart) / 3_600_000)
  return { date: start.date, from, to: Math.max(from, to) }
}

/** PURE. The scheduled activities for one activity on one local date, by start. */
export function scheduledOn(
  items: readonly ScheduledActivity[],
  activityId: string,
  dateStr: string,
  timeZone: string,
): { item: ScheduledActivity; span: ScheduledSpan }[] {
  return items
    .filter(item => item.activityId === activityId)
    .map(item => ({ item, span: scheduledSpan(item, timeZone) }))
    .filter(({ span }) => span.date === dateStr)
    .sort((a, b) => a.span.from - b.span.from)
}

/** PURE. Activities that have not ended yet at `nowMs`, soonest first. */
export function upcomingScheduled(
  items: readonly ScheduledActivity[],
  nowMs: number,
): ScheduledActivity[] {
  return items
    .filter(item => Date.parse(item.end) > nowMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/** Length of a scheduled activity in fractional hours. */
export function durationHours(item: ScheduledActivity): number {
  return (Date.parse(item.end) - Date.parse(item.start)) / 3_600_000
}

/**
 * PURE. Start times for "Change time": every START_STEP_MINUTES within the day's
 * lower-UV windows where the whole activity still fits, from `nowHour` on (today;
 * -1 for other days).
 */
export function startOptions(
  windows: readonly Pick<SafeActivityWindow, 'from' | 'to'>[],
  hours: number,
  nowHour = -1,
): number[] {
  const step = START_STEP_MINUTES / 60
  const out: number[] = []
  for (const win of windows) {
    const first = Math.ceil(Math.max(win.from, nowHour) / step - 1e-9) * step
    for (let h = first; h + hours <= win.to + 1e-9; h += step) {
      const rounded = Math.round(h * 60) / 60
      if (!out.includes(rounded)) out.push(rounded)
    }
  }
  return out.sort((a, b) => a - b)
}

// ---- Google events -> records ---------------------------------------------------------

/** The instant of an event time; an all-day date reads as local midnight. */
function eventInstant(time: GoogleEvent['start'], fallbackTimeZone: string): number | null {
  if (time?.dateTime) {
    const ms = Date.parse(time.dateTime)
    return Number.isNaN(ms) ? null : ms
  }
  if (time?.date && isIsoDate(time.date)) {
    const zone = isValidTimeZone(time.timeZone) ? time.timeZone : fallbackTimeZone
    const ms = zonedInstant(time.date, 0, zone)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

export interface RecordContext {
  /** The record being updated, if any: its activity, icon and creation time carry over. */
  previous?: ScheduledActivity
  /** The user's activities, to name and decorate an event found only in Google. */
  activities?: readonly Activity[]
  /** Zone to store when the event names none. */
  timeZone: string
  /** ISO time of this change. */
  now: string
}

/** PURE. The stored record for a Google event, or null when the event cannot be stored. */
export function recordFromEvent(
  event: GoogleEvent,
  context: RecordContext,
): ScheduledActivity | null {
  const { previous, activities = [], timeZone, now } = context
  const zone = [event.start?.timeZone, previous?.timeZone, timeZone].find(isValidTimeZone)
  if (!zone) return null
  const start = eventInstant(event.start, zone)
  const end = eventInstant(event.end, zone)
  if (start === null || end === null || end <= start) return null
  const activityId =
    previous?.activityId ?? event.extendedProperties?.private?.[SOLARA_ACTIVITY_PROPERTY] ?? ''
  const activity = activities.find(a => a.id === activityId)
  const link = event.htmlLink ?? previous?.htmlLink ?? ''
  if (!EVENT_LINK_PATTERN.test(link)) return null
  return parseScheduledActivity({
    eventId: event.id,
    calendarId: 'primary',
    activityId: capText(activityId, SCHEDULED_LIMITS.activityIdLength),
    title: capText(event.summary ?? previous?.title ?? '', SCHEDULED_LIMITS.titleLength),
    icon: capText(previous?.icon ?? activity?.icon ?? '📅', SCHEDULED_LIMITS.iconLength),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    timeZone: zone,
    htmlLink: link,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  })
}

/** True when two records show the same thing (timestamps aside). */
function sameContent(a: ScheduledActivity, b: ScheduledActivity): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.title === b.title &&
    a.htmlLink === b.htmlLink &&
    a.timeZone === b.timeZone
  )
}

export interface ReconcilePlan {
  /** Records to write: events moved or renamed in Google, and Solara events with no record. */
  upserts: ScheduledActivity[]
  /** Event ids whose records go: deleted or cancelled in Google. */
  removals: string[]
}

/**
 * PURE. What to change so the stored records match Google.
 *
 * `found` maps each stored record's event id to the event Google returned for it, or
 * null when Google says it is gone (404/410). Records missing from `found` were not
 * checked and stay as they are. `listed` are Solara-tagged events from a range query;
 * any of them without a record (for example, a create whose record write failed) is
 * adopted.
 */
export function planReconcile(
  records: readonly ScheduledActivity[],
  found: ReadonlyMap<string, GoogleEvent | null>,
  listed: readonly GoogleEvent[],
  context: Omit<RecordContext, 'previous'>,
): ReconcilePlan {
  const upserts: ScheduledActivity[] = []
  const removals: string[] = []
  const known = new Set(records.map(r => r.eventId))
  for (const record of records) {
    if (!found.has(record.eventId)) continue
    const event = found.get(record.eventId)
    if (!event || event.status === 'cancelled') {
      removals.push(record.eventId)
      continue
    }
    const next = recordFromEvent(event, { ...context, previous: record })
    if (next && !sameContent(next, record)) upserts.push(next)
  }
  for (const event of listed) {
    if (known.has(event.id) || event.status === 'cancelled') continue
    const adopted = recordFromEvent(event, context)
    if (adopted) {
      upserts.push(adopted)
      known.add(event.id)
    }
  }
  return { upserts, removals }
}

// ---- Storage -------------------------------------------------------------------------

function scheduledCollection(uid: string) {
  if (!db) throw new Error('Firestore is not configured')
  return collection(db, 'users', uid, 'scheduled')
}

/**
 * Live list of the account's scheduled activities, by start time. Invalid records
 * are skipped. Returns the unsubscribe function.
 *
 * A read is capped at SCHEDULED_LIMITS.listLimit records (the rules require it), so
 * it takes the latest-starting ones: upcoming events always make the list, and only
 * the oldest history can fall outside it until pruning catches up.
 */
export function subscribeScheduled(
  uid: string,
  onItems: (items: ScheduledActivity[]) => void,
  onError: (error: Error) => void,
): () => void {
  const q = query(
    scheduledCollection(uid),
    orderBy('start', 'desc'),
    limit(SCHEDULED_LIMITS.listLimit),
  )
  return onSnapshot(
    q,
    snapshot => {
      const items: ScheduledActivity[] = []
      for (const d of snapshot.docs) {
        const item = parseScheduledActivity(d.data())
        if (item && item.eventId === d.id) items.push(item)
      }
      onItems(items.reverse())
    },
    onError,
  )
}

export async function saveScheduled(uid: string, item: ScheduledActivity): Promise<void> {
  await setDoc(doc(scheduledCollection(uid), item.eventId), item)
}

export async function deleteScheduled(uid: string, eventId: string): Promise<void> {
  await deleteDoc(doc(scheduledCollection(uid), eventId))
}
