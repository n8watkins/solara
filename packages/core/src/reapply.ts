// The sunscreen reapply timer: started when you head out, it reminds you to reapply
// every 2 hours, or every 80 minutes while swimming or sweating (the FDA's
// water-resistance limit and the usual 2-hour guidance). It lives on the device, so it
// works for guests and without push; the reminder is a system notification where the
// device allows one, and an in-app banner always.
//
// For a signed-in account with notifications on, the server also keeps one "remind me
// at" record and sends the reminder as a push at that time, so it arrives with every
// Solara tab closed (functions/src/notifications/reminders.ts). The push and the
// device's own notification share one tag (`reminderTag`), so a device shows it once.
//
// Free for every plan (a safety feature). This is the pure timer; the web app keeps it
// in localStorage (lib/reapply.ts), a native client in its own store.

/** Minutes between reminders. */
export const REAPPLY_MINUTES = Object.freeze({ standard: 120, water: 80 })

/** 'standard' reminds every 2 hours, 'water' every 80 minutes. */
export type ReapplyMode = 'standard' | 'water'

export interface ReapplyTimer {
  /** When the timer was started (epoch ms). */
  startedAt: number
  /** When sunscreen was last put on: the start, or the last "I reapplied". */
  appliedAt: number
  mode: ReapplyMode
  /** The reminder a system notification was already shown for (its due time). */
  notifiedFor?: number
  /**
   * The tag of the push the server will send for this reminder (signed in, with
   * notifications on): the device's own notification uses it too, so only one shows.
   */
  reminderTag?: string
}

/** The reminder's words, the same in the browser's notification and the server's push. */
export function reapplyReminderMessage(mode: ReapplyMode): { title: string; body: string } {
  return {
    title: 'Time to reapply sunscreen',
    body:
      mode === 'water'
        ? `It has been ${REAPPLY_MINUTES.water} minutes of swimming or sweating since you put it on.`
        : `It has been ${REAPPLY_MINUTES.standard / 60} hours since you put it on.`,
  }
}

/** Server-side reminder tags look like "<scope>:reapply-v1:<id>"; anything else is dropped. */
const REMINDER_TAG = /^[A-Za-z0-9_-]{1,64}:reapply-v1:[A-Za-z0-9-]{1,64}$/

/** Whether a stored value is a reminder tag the server could have given. */
export function isReminderTag(value: unknown): value is string {
  return typeof value === 'string' && REMINDER_TAG.test(value)
}

/** The timer with the tag of its server push, once the server has scheduled one. */
export function withReminderTag(timer: ReapplyTimer, tag: string | null): ReapplyTimer {
  const { reminderTag: _, ...rest } = timer
  return tag && isReminderTag(tag) ? { ...rest, reminderTag: tag } : rest
}

export function startTimer(now: number, mode: ReapplyMode = 'standard'): ReapplyTimer {
  return { startedAt: now, appliedAt: now, mode }
}

/** A running timer is dropped this long after it started: a day out is over by then. */
export const REAPPLY_MAX_AGE_MS = 12 * 60 * 60 * 1000

const MINUTE = 60_000

/** Reapplied now: the next reminder counts from here. */
export function reapplied(timer: ReapplyTimer, now: number): ReapplyTimer {
  return { startedAt: timer.startedAt, appliedAt: now, mode: timer.mode }
}

/** Switches between the 2-hour and the water or sweat interval, keeping the last application. */
export function withMode(timer: ReapplyTimer, mode: ReapplyMode): ReapplyTimer {
  // The server's push was for the old time: the tag comes back with the new schedule.
  const { reminderTag: _, ...rest } = timer
  return { ...rest, mode }
}

/** When the next reminder is due (epoch ms). */
export function dueAt(timer: ReapplyTimer): number {
  return timer.appliedAt + REAPPLY_MINUTES[timer.mode] * MINUTE
}

export function isDue(timer: ReapplyTimer, now: number): boolean {
  return now >= dueAt(timer)
}

/** Whether a system notification should be shown for the current reminder. */
export function shouldNotify(timer: ReapplyTimer, now: number): boolean {
  return isDue(timer, now) && timer.notifiedFor !== dueAt(timer)
}

export function markNotified(timer: ReapplyTimer): ReapplyTimer {
  return { ...timer, notifiedFor: dueAt(timer) }
}

/** Whole minutes until the reminder, at least 0, rounded up so "1 min" lasts until it is due. */
export function minutesLeft(timer: ReapplyTimer, now: number): number {
  return Math.max(0, Math.ceil((dueAt(timer) - now) / MINUTE))
}

/** "1 h 20 min", "45 min", "1 h": the one duration style (duration.ts). */
export { formatDuration } from './duration'

/** A stored timer, or null when there is none, it is malformed, or it is too old. */
export function parseTimer(raw: unknown, now: number): ReapplyTimer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { startedAt, appliedAt, mode, notifiedFor, reminderTag } = raw as Record<string, unknown>
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
  if (typeof appliedAt !== 'number' || !Number.isFinite(appliedAt)) return null
  if (mode !== 'standard' && mode !== 'water') return null
  if (appliedAt < startedAt || startedAt > now || now - startedAt > REAPPLY_MAX_AGE_MS) return null
  return {
    startedAt,
    appliedAt: Math.min(appliedAt, now),
    mode,
    ...(typeof notifiedFor === 'number' && Number.isFinite(notifiedFor) ? { notifiedFor } : {}),
    ...(isReminderTag(reminderTag) ? { reminderTag } : {}),
  }
}

/** What the "remind me at" record holds (firestore.rules validReapplyReminder), in epoch ms. */
export interface ReapplyReminderRecord {
  /** 32 lowercase hex characters, new for every schedule. */
  id: string
  mode: ReapplyMode
  appliedAt: number
  remindAt: number
  /** Marks it waiting; the server removes it when it sends the push. */
  dueAt: number
  /** A day after `remindAt`: Firestore's TTL removes a record left behind. */
  expireAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The record that schedules a running timer's next reminder as a push. */
export function reapplyReminderRecord(timer: ReapplyTimer, id: string): ReapplyReminderRecord {
  const remindAt = dueAt(timer)
  return {
    id,
    mode: timer.mode,
    appliedAt: timer.appliedAt,
    remindAt,
    dueAt: remindAt,
    expireAt: remindAt + DAY_MS,
  }
}
