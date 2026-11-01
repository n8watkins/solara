// The reapply timer's reminder as a push, so it arrives with Solara closed: a signed-in
// account keeps one "remind me at" record, `users/{uid}/reminders/reapply`, which
// firestore.rules validate and the server sends and deletes
// (functions/src/notifications/reminders.ts). Free on every account, once the alerts
// are switched on (lib/plans.ts alertsLaunched), since the push needs the Functions.
//
// Every write starts a Cloud Function, so the rules accept one at most every
// REAPPLY_REMINDER_WRITE_GAP_MS (REVIEW9 SEC9 M1), stamped in `reminders/writes` in the
// same batch. A quick Start, "I reapplied" and "Swimming" are spaced here: a write that
// comes too soon waits for the gap and only the latest is sent; one refused because
// another tab or device just wrote is sent once more after the gap. Stop is never held
// back. A write still waiting when the tab closes is lost, and the push then comes at the
// earlier schedule's time (the tab's own notification is unaffected).
import { reapplyReminderTag } from '@solara/core/push'
import {
  REAPPLY_REMINDER_WRITE_GAP_MS,
  REAPPLY_REMINDER_WRITES_DOC,
  reapplyReminderRecord,
  type ReapplyTimer,
} from '@solara/core/reapply'
import { canUseReapplyPush } from '@solara/core/tiers'
import { loadFirebase } from './firebase'
import { alertsLaunched } from './plans'
import type { TierLevel } from './types'

/** Whether this account's reapply reminders also come as a push. */
export function reapplyPushAvailable(tier: TierLevel | undefined): boolean {
  return !!tier && canUseReapplyPush(tier) && alertsLaunched()
}

/**
 * The UI harness has no Firebase: a screen opts in with ?reminders=devices (the account
 * has a device with alerts on) or ?reminders=none, and nothing is stored. Outside a
 * harness build this is compiled away.
 */
function harnessReminders(): 'devices' | 'none' | null {
  if (process.env.NEXT_PUBLIC_UI_HARNESS !== '1' || typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('reminders')
  return value === 'devices' || value === 'none' ? value : null
}

/** A new record id: 32 lowercase hex characters, as the rules require. */
function reminderId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function reminderDoc(uid: string) {
  const db = (await loadFirebase())?.db
  if (!db) throw new Error('Firestore is not configured')
  const firestore = await import('firebase/firestore')
  return {
    db,
    firestore,
    ref: firestore.doc(db, 'users', uid, 'reminders', 'reapply'),
    writesRef: firestore.doc(db, 'users', uid, 'reminders', REAPPLY_REMINDER_WRITES_DOC),
  }
}

/** The rules' gap, and a second more for the distance between this clock and the server's. */
const WRITE_SPACING_MS = REAPPLY_REMINDER_WRITE_GAP_MS + 1000

interface Waiter {
  resolve: () => void
  reject: (error: unknown) => void
}

interface PendingWrite {
  handle: ReturnType<typeof setTimeout>
  waiters: Waiter[]
}

/** When this tab last sent a write, the write waiting for the gap, and Stop's count. */
const writes: { lastSentAt: number; pending: PendingWrite | null; generation: number } = {
  lastSentAt: Number.NEGATIVE_INFINITY,
  pending: null,
  generation: 0,
}

function isPermissionDenied(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'permission-denied'
}

/**
 * Sends `write` once the gap since this tab's last write has passed, replacing any write
 * still waiting (whose callers then settle with this one). Settles when the server has it.
 */
function spaced(write: () => Promise<void>, waiters: Waiter[], retried = false): void {
  const { pending } = writes
  if (pending) {
    clearTimeout(pending.handle)
    waiters = [...pending.waiters, ...waiters]
  }
  const generation = writes.generation
  const send = async () => {
    writes.pending = null
    // Stopped meanwhile: nothing to schedule.
    if (generation !== writes.generation) {
      for (const waiter of waiters) waiter.resolve()
      return
    }
    writes.lastSentAt = Date.now()
    try {
      await write()
      for (const waiter of waiters) waiter.resolve()
    } catch (error) {
      const newer = writes.pending as PendingWrite | null
      if (newer) {
        // A newer write is waiting: its outcome is theirs too.
        newer.waiters.push(...waiters)
      } else if (!retried && isPermissionDenied(error) && generation === writes.generation) {
        // Another tab or device wrote within the gap: once more after it.
        spaced(write, waiters, true)
      } else {
        for (const waiter of waiters) waiter.reject(error)
      }
    }
  }
  const handle = setTimeout(
    () => void send(),
    Math.max(0, writes.lastSentAt + WRITE_SPACING_MS - Date.now()),
  )
  writes.pending = { handle, waiters }
}

/**
 * Schedules the push for a running timer's next reminder, replacing any earlier one, and
 * returns the tag it will carry for the timer to use too. The write is Firestore's, so
 * offline it is sent once the device is back online; `committed` settles when the server
 * has it (after the rules' gap since the last write, when one was just sent).
 */
export async function scheduleReapplyReminder(
  uid: string,
  timer: ReapplyTimer,
): Promise<{ tag: string; committed: Promise<void> }> {
  const record = reapplyReminderRecord(timer, reminderId())
  if (harnessReminders()) {
    return { tag: reapplyReminderTag(uid, record.id), committed: Promise.resolve() }
  }
  const { db, firestore, ref, writesRef } = await reminderDoc(uid)
  const at = (ms: number) => firestore.Timestamp.fromMillis(ms)
  const write = () => {
    const batch = firestore.writeBatch(db)
    batch.set(ref, {
      id: record.id,
      mode: record.mode,
      appliedAt: at(record.appliedAt),
      remindAt: at(record.remindAt),
      dueAt: at(record.dueAt),
      expireAt: at(record.expireAt),
    })
    batch.set(writesRef, { writtenAt: firestore.serverTimestamp() })
    return batch.commit()
  }
  const committed = new Promise<void>((resolve, reject) => spaced(write, [{ resolve, reject }]))
  return { tag: reapplyReminderTag(uid, record.id), committed }
}

/** Stop: deletes the record, so no push comes, and drops any write still waiting. */
export async function cancelReapplyReminder(uid: string): Promise<void> {
  writes.generation += 1
  const { pending } = writes
  if (pending) {
    clearTimeout(pending.handle)
    writes.pending = null
    for (const waiter of pending.waiters) waiter.resolve()
  }
  if (harnessReminders()) return
  const { firestore, ref } = await reminderDoc(uid)
  await firestore.deleteDoc(ref)
}

/** Whether any device of the account has notifications on (so the push reaches someone). */
export async function hasNotificationDevice(uid: string): Promise<boolean> {
  const harness = harnessReminders()
  if (harness) return harness === 'devices'
  const db = (await loadFirebase())?.db
  if (!db) return false
  const { collection, getDocs, limit, query, where } = await import('firebase/firestore')
  const snapshot = await getDocs(
    query(
      collection(db, 'users', uid, 'notificationDevices'),
      where('enabled', '==', true),
      limit(5),
    ),
  )
  return !snapshot.empty
}
