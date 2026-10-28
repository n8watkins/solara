// Scheduled activities: the Google Calendar events Solara created, kept in Firestore
// (users/{uid}/scheduled/{eventId}) so every device shows them at once, and
// reconciled with Google when a token is available.
//
// The record schema lives in @solara/core (packages/core/src/scheduled.ts). This module
// holds the pure conversions and reconciliation (unit-tested) and the Firestore storage,
// which loads Firestore on demand (lib/firebase.ts).
import {
  capText,
  EVENT_LINK_PATTERN,
  parseScheduledActivity,
  SCHEDULED_LIMITS,
  SCHEDULED_RETENTION_DAYS,
  SCHEDULED_TTL_FIELD,
  scheduledExpiry,
  SOLARA_ACTIVITY_PROPERTY,
  type ScheduledActivity,
} from '@solara/core'
import { lazySubscription, loadFirebase } from './firebase'
import type { GoogleEvent } from './gcal'
import { isIsoDate, isValidTimeZone, zonedInstant } from './time'
import type { Activity } from './types'

export type { ScheduledActivity }
export {
  durationHours,
  scheduledOn,
  scheduledSpan,
  startOptions,
  START_STEP_MINUTES,
  upcomingScheduled,
  type ScheduledSpan,
} from './scheduled-view'

/** Records that ended longer ago than this are pruned (and expire in Firestore). */
export const SCHEDULED_RETENTION_MS = SCHEDULED_RETENTION_DAYS * 86_400_000

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

/** The account's `scheduled` collection and the Firestore functions to use on it. */
async function scheduledCollection(uid: string) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return { firestore, scheduled: firestore.collection(db, 'users', uid, 'scheduled') }
}

/**
 * Live list of the account's scheduled activities, by start time. Invalid records
 * are skipped. Returns the unsubscribe function.
 *
 * A read is capped at SCHEDULED_LIMITS.listLimit records (the rules require it), so
 * it takes the latest-starting ones: upcoming events always make the list, and only
 * the oldest history can fall outside it. Expired records are deleted by
 * pruneExpiredScheduled, which queries for them directly.
 */
export function subscribeScheduled(
  uid: string,
  onItems: (items: ScheduledActivity[]) => void,
  onError: (error: Error) => void,
): () => void {
  return lazySubscription(
    async () => {
      const { firestore, scheduled } = await scheduledCollection(uid)
      const { limit, onSnapshot, orderBy, query } = firestore
      const q = query(scheduled, orderBy('start', 'desc'), limit(SCHEDULED_LIMITS.listLimit))
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
    },
    error => onError(error instanceof Error ? error : new Error(String(error))),
  )
}

/**
 * PURE. The document stored for a record: the record plus its expiry, so Firestore's TTL
 * policy deletes it even if the account never opens Solara again.
 */
export function scheduledDocument(item: ScheduledActivity) {
  return { ...item, [SCHEDULED_TTL_FIELD]: scheduledExpiry(item) }
}

/**
 * Saves a record with its key listed in users/{uid}/meta/scheduled, which the rules use
 * to cap an account at SCHEDULED_LIMITS.maxStored records (lib/key-index.ts). Throws a
 * RecordCapError when a new record does not fit.
 */
export async function saveScheduled(uid: string, item: ScheduledActivity): Promise<void> {
  const { saveWithinCap, RecordCapError, KEY_INDEX_CAPS } = await import('./key-index')
  const refused = await saveWithinCap(uid, 'scheduled', [
    { key: item.eventId, data: scheduledDocument(item) },
  ])
  if (refused.length) throw new RecordCapError('scheduled', KEY_INDEX_CAPS.scheduled)
}

/** Throws a RecordCapError when the account cannot hold another record. */
export async function assertScheduledRoom(uid: string): Promise<void> {
  const { listedKeys, reconcile, RecordCapError, KEY_INDEX_CAPS } = await import('./key-index')
  const cap = KEY_INDEX_CAPS.scheduled
  if ((await listedKeys(uid, 'scheduled')).size < cap) return
  if ((await reconcile(uid, 'scheduled')).size >= cap) throw new RecordCapError('scheduled', cap)
}

export async function deleteScheduled(uid: string, eventId: string): Promise<void> {
  const { removeRecords } = await import('./key-index')
  await removeRecords(uid, 'scheduled', [eventId])
}

/**
 * PURE. The stored `end` before which a record is pruned, in the stored format (an ISO
 * instant in UTC, which sorts as text in the same order as time).
 */
export function scheduledRetentionCutoff(nowMs: number): string {
  return new Date(nowMs - SCHEDULED_RETENTION_MS).toISOString()
}

/** Most pages one pruning pass deletes, so a huge backlog cannot keep a session busy. */
const MAX_PRUNE_PAGES = 10

/**
 * Deletes the account's records that ended more than SCHEDULED_RETENTION_MS ago and
 * returns how many it deleted. It queries for them directly (`end` is an ISO instant in
 * UTC, so it sorts as text), so it reaches records the capped live list never returns.
 * A backlog larger than MAX_PRUNE_PAGES pages is finished on the next pass.
 */
export async function pruneExpiredScheduled(uid: string, nowMs: number): Promise<number> {
  const cutoff = scheduledRetentionCutoff(nowMs)
  let deleted = 0
  const { firestore, scheduled } = await scheduledCollection(uid)
  const { getDocs, limit, orderBy, query, where } = firestore
  const { removeRecords } = await import('./key-index')
  for (let page = 0; page < MAX_PRUNE_PAGES; page += 1) {
    const snapshot = await getDocs(
      query(
        scheduled,
        where('end', '<', cutoff),
        orderBy('end'),
        limit(SCHEDULED_LIMITS.listLimit),
      ),
    )
    await removeRecords(
      uid,
      'scheduled',
      snapshot.docs.map(d => d.id),
    )
    deleted += snapshot.size
    if (snapshot.size < SCHEDULED_LIMITS.listLimit) break
  }
  return deleted
}
