// The sunscreen reapply reminder as a push, so it arrives with every Solara tab closed.
//
// The reapply timer runs in the browser (packages/core/src/reapply.ts). For a signed-in
// account, starting it, "I reapplied" or switching to swimming writes one "remind me
// at" record, `users/{uid}/reminders/reapply` (lib/reapply-reminder.ts), which
// firestore.rules validate (its id, mode, times and nothing else) and let only the
// owner write; Stop deletes it. One record per account: a new schedule replaces the old
// one with a new id, so an old delivery finds a different id and sends nothing. The
// browser writes it through the Firestore SDK, so a timer started offline is scheduled
// once the phone is back online.
//
// Delivery, at most once:
//
// 1. On time: each written record (`reapplyReminderScheduled`, functions.ts) is checked
//    and counted against the account's daily cap, and a Cloud Tasks task is enqueued
//    for its time, which runs `reapplyReminderTask` to deliver it.
// 2. Backstop: every 15-minute `alerts` run also sweeps reminders more than
//    REMINDER_SWEEP_GRACE_MS overdue (`dueAt` is only set while a reminder waits), so a
//    reminder whose task could not be enqueued or did not run still arrives, late by at
//    most one run.
//
// Either path claims the record in a transaction (removing `dueAt`) before sending, so
// the two never both send; once sent (or found to have no devices) the record is
// deleted, and its `expireAt` (TTL) removes any left behind. The push carries the tag
// `<deliveryScope>:reapply-v1:<id>` (core push.ts `reapplyReminderTag`), which the
// browser's own reminder uses too, so one device never shows the reminder twice.
//
// Caps: REAPPLY_SCHEDULES_PER_DAY schedules and REAPPLY_SENDS_PER_DAY pushes per account
// and UTC day (`alertState/reapply`).

import { reapplyDeliveryKey } from '#core/push'
import { REAPPLY_MINUTES, type ReapplyMode, reapplyReminderMessage } from '#core/reapply'

import { FieldValue, type DocumentData, type Firestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { loggableError } from '../shared/errors'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'
import {
  ALERT_STATE_COLLECTION,
  type AlertMessaging,
  type Delivery,
  type SendResult,
  alertDevices,
  sendToDevices,
} from './alerts'

export const REMINDER_COLLECTION = 'reminders'
export const REAPPLY_REMINDER_DOC = 'reapply'
/** users/{uid}/alertState/{REAPPLY_STATE_DOC}: the day's schedule and send counts. */
export const REAPPLY_STATE_DOC = 'reapply'
/** Schedules one account may make in a UTC day (start, reapplied, mode switches). */
export const REAPPLY_SCHEDULES_PER_DAY = 40
/** Reminder pushes one account may get in a UTC day (12 hours of 80-minute reminders is 9). */
export const REAPPLY_SENDS_PER_DAY = 12
/** The sweep leaves a reminder to its task this long after it falls due. */
export const REMINDER_SWEEP_GRACE_MS = 2 * 60_000
/** Most overdue reminders one sweep sends. */
export const REMINDER_SWEEP_MAX = 500

/** The task payload: which account's reminder, and which schedule of it. */
export interface ReminderTask {
  uid: string
  id: string
}

/** Enqueues the delivery task for a reminder at its time (Cloud Tasks in production). */
export type ReminderEnqueue = (task: ReminderTask, at: Date) => Promise<void>

export { reapplyDeliveryKey }

/** The UTC day the per-account caps count in. */
function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

function count(state: DocumentData | undefined, field: 'scheduled' | 'sent', day: string): number {
  if (state?.day !== day) return 0
  const value = state[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function millis(value: unknown): number | null {
  return value instanceof Timestamp
    ? value.toMillis()
    : value instanceof Date
      ? value.getTime()
      : null
}

/** A waiting reminder as the rules let the browser write it, or null. */
export function parseReminder(
  data: DocumentData | undefined,
): { id: string; mode: ReapplyMode; remindAt: number; dueAt: number } | null {
  if (!data) return null
  const id: unknown = data.id
  const mode: unknown = data.mode
  const appliedAt = millis(data.appliedAt)
  const remindAt = millis(data.remindAt)
  const dueAt = millis(data.dueAt)
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return null
  if (mode !== 'standard' && mode !== 'water') return null
  if (appliedAt === null || remindAt === null || dueAt === null) return null
  if (remindAt !== appliedAt + REAPPLY_MINUTES[mode] * 60_000 || dueAt !== remindAt) return null
  return { id, mode, remindAt, dueAt }
}

export type ScheduleOutcome =
  'scheduled' | 'not-waiting' | 'unchanged' | 'invalid' | 'capped' | 'off'

/**
 * A reminder record was written: when it is a new waiting schedule, counts it against
 * the account's daily cap and enqueues its delivery. The server's own claim and delete
 * also land here and do nothing. Over the cap, or invalid, the record is deleted.
 */
export async function reminderWritten({
  db,
  uid,
  before,
  after,
  enqueue,
  enabled,
  nowMs = Date.now(),
}: {
  db: Firestore
  uid: string
  before: DocumentData | undefined
  after: DocumentData | undefined
  enqueue: ReminderEnqueue
  /** ALERTS_ENABLED: while off, nothing is enqueued (the sweep is off too). */
  enabled: boolean
  nowMs?: number
}): Promise<ScheduleOutcome> {
  if (!enabled) return 'off'
  if (!after || after.dueAt === undefined) return 'not-waiting'
  const userRef = db.collection('users').doc(uid)
  const reminderRef = userRef.collection(REMINDER_COLLECTION).doc(REAPPLY_REMINDER_DOC)
  const reminder = parseReminder(after)
  if (!reminder) {
    // The rules allow no other shape; one written another way is not sent.
    await reminderRef.delete()
    return 'invalid'
  }
  const prior = parseReminder(before)
  if (prior?.id === reminder.id && prior.remindAt === reminder.remindAt) return 'unchanged'

  const stateRef = userRef.collection(ALERT_STATE_COLLECTION).doc(REAPPLY_STATE_DOC)
  const day = utcDay(nowMs)
  const allowed = await db.runTransaction(async transaction => {
    const [state, current] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(reminderRef),
    ])
    // Replaced or stopped meanwhile: the newer write is counted on its own.
    if (current.data()?.id !== reminder.id) return null
    const used = count(state.data(), 'scheduled', day)
    if (used >= REAPPLY_SCHEDULES_PER_DAY) {
      transaction.delete(reminderRef)
      return false
    }
    transaction.set(
      stateRef,
      {
        day,
        scheduled: used + 1,
        sent: count(state.data(), 'sent', day),
        expireAt: expiresAfter(RETENTION_DAYS.alertState, new Date(nowMs)),
      },
      { merge: true },
    )
    return true
  })
  if (allowed === null) return 'unchanged'
  if (!allowed) {
    logger.warn('reapply reminder over the daily cap; not sent', { cap: REAPPLY_SCHEDULES_PER_DAY })
    return 'capped'
  }
  try {
    await enqueue({ uid, id: reminder.id }, new Date(reminder.remindAt))
  } catch (error) {
    // The alerts job's sweep sends it within one run of its time instead.
    logger.warn('reapply reminder task not enqueued; the alerts sweep will send it', {
      error: loggableError(error),
    })
  }
  return 'scheduled'
}

export type ReminderOutcome =
  'sent' | 'failed' | 'unknown' | 'stale' | 'early' | 'capped' | 'no-devices' | 'no-account'

export interface ReminderDependencies {
  db: Firestore
  messaging: AlertMessaging
  appUrl: string
  now?: () => number
}

/**
 * Delivers one account's reminder if it is still the schedule `id` (a task's) or any
 * waiting one (the sweep's, `id` omitted), at most once.
 */
export async function deliverReapplyReminder(
  deps: ReminderDependencies,
  uid: string,
  id?: string,
): Promise<ReminderOutcome> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()
  const userRef = db.collection('users').doc(uid)
  const reminderRef = userRef.collection(REMINDER_COLLECTION).doc(REAPPLY_REMINDER_DOC)
  const stateRef = userRef.collection(ALERT_STATE_COLLECTION).doc(REAPPLY_STATE_DOC)
  const day = utcDay(now)

  const claimed = await db.runTransaction(async transaction => {
    const [reminder, user, state] = await Promise.all([
      transaction.get(reminderRef),
      transaction.get(userRef),
      transaction.get(stateRef),
    ])
    const waiting = parseReminder(reminder.data())
    if (!waiting || (id !== undefined && waiting.id !== id)) return 'stale' as const
    const dueAt = waiting.dueAt
    // Cloud Tasks runs a task at or after its time; a little early is the server's clock.
    if (dueAt > now + 60_000) return 'early' as const
    if (!user.exists || user.data()?.accountDeletionStartedAt) {
      transaction.delete(reminderRef)
      return 'no-account' as const
    }
    const sent = count(state.data(), 'sent', day)
    if (sent >= REAPPLY_SENDS_PER_DAY) {
      transaction.delete(reminderRef)
      return 'capped' as const
    }
    transaction.update(reminderRef, {
      dueAt: FieldValue.delete(),
      status: 'claimed',
      claimedAt: new Date(now),
    })
    transaction.set(
      stateRef,
      {
        day,
        sent: sent + 1,
        scheduled: count(state.data(), 'scheduled', day),
        expireAt: expiresAfter(RETENTION_DAYS.alertState, new Date(now)),
      },
      { merge: true },
    )
    return { id: waiting.id, mode: waiting.mode }
  })
  if (typeof claimed === 'string') return claimed

  let result: SendResult | 'no-devices'
  try {
    const devices = await alertDevices(db, userRef)
    if (devices.length === 0) {
      result = 'no-devices'
    } else {
      const delivery: Delivery = {
        kind: 'reapply',
        field: REAPPLY_REMINDER_DOC,
        day,
        key: reapplyDeliveryKey(claimed.id),
      }
      result = await sendToDevices(
        { deps, removedDevices: 0 },
        uid,
        devices,
        delivery,
        reapplyReminderMessage(claimed.mode),
      )
    }
  } catch (error) {
    // Claimed but not known to be sent: never sent again (at most once); the TTL tidies up.
    logger.error('reapply reminder delivery failed', { error: loggableError(error) })
    return 'unknown'
  }
  // Sent, or nothing more to do: the record has served its purpose.
  await reminderRef.delete().catch(error => {
    logger.warn('a sent reapply reminder could not be removed', { error: loggableError(error) })
  })
  return result === 'no-devices'
    ? 'no-devices'
    : result.status === 'delivered'
      ? 'sent'
      : result.status
}

export interface SweepResult {
  checked: number
  outcomes: Partial<Record<ReminderOutcome, number>>
}

/**
 * The backstop in each `alerts` run: every reminder more than REMINDER_SWEEP_GRACE_MS
 * overdue, oldest first, within a time budget. With the tasks running, it finds none and
 * costs one read.
 */
export async function sweepReapplyReminders(
  deps: ReminderDependencies,
  { max = REMINDER_SWEEP_MAX, budgetMs = 30_000 }: { max?: number; budgetMs?: number } = {},
): Promise<SweepResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const overdue = await deps.db
    .collectionGroup(REMINDER_COLLECTION)
    .where('dueAt', '<=', new Date(startedAt - REMINDER_SWEEP_GRACE_MS))
    .orderBy('dueAt')
    .limit(max)
    .get()
  const outcomes: Partial<Record<ReminderOutcome, number>> = {}
  let checked = 0
  for (const doc of overdue.docs) {
    if (now() - startedAt >= budgetMs) break
    const uid = doc.ref.parent.parent?.id
    if (doc.id !== REAPPLY_REMINDER_DOC || !uid) continue
    checked += 1
    try {
      const outcome = await deliverReapplyReminder(deps, uid)
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    } catch (error) {
      logger.error('reapply reminder sweep failed for an account', { error: loggableError(error) })
    }
  }
  if (overdue.docs.length > 0) {
    // Reminders reached by the sweep mean their tasks did not run: worth a look.
    logger.warn('reapply reminders sent by the alerts sweep', { checked, outcomes })
  }
  return { checked, outcomes }
}
