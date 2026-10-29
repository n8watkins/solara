// The reapply timer's reminder as a push, so it arrives with Solara closed: a signed-in
// account keeps one "remind me at" record, `users/{uid}/reminders/reapply`, which
// firestore.rules validate and the server sends and deletes
// (functions/src/notifications/reminders.ts). Free on every account, once the alerts
// are switched on (lib/plans.ts alertsLaunched), since the push needs the Functions.
import { reapplyReminderTag } from '@solara/core/push'
import { reapplyReminderRecord, type ReapplyTimer } from '@solara/core/reapply'
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
  return { firestore, ref: firestore.doc(db, 'users', uid, 'reminders', 'reapply') }
}

/**
 * Schedules the push for a running timer's next reminder, replacing any earlier one, and
 * returns the tag it will carry for the timer to use too. The write is Firestore's, so
 * offline it is sent once the device is back online; `committed` settles when the server
 * has it.
 */
export async function scheduleReapplyReminder(
  uid: string,
  timer: ReapplyTimer,
): Promise<{ tag: string; committed: Promise<void> }> {
  const record = reapplyReminderRecord(timer, reminderId())
  if (harnessReminders()) {
    return { tag: reapplyReminderTag(uid, record.id), committed: Promise.resolve() }
  }
  const { firestore, ref } = await reminderDoc(uid)
  const at = (ms: number) => firestore.Timestamp.fromMillis(ms)
  const committed = firestore.setDoc(ref, {
    id: record.id,
    mode: record.mode,
    appliedAt: at(record.appliedAt),
    remindAt: at(record.remindAt),
    dueAt: at(record.dueAt),
    expireAt: at(record.expireAt),
  })
  return { tag: reapplyReminderTag(uid, record.id), committed }
}

/** Stop: deletes the record, so no push comes. */
export async function cancelReapplyReminder(uid: string): Promise<void> {
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
