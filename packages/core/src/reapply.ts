// The sunscreen reapply timer: started when you head out, it reminds you to reapply
// every 2 hours, or every 80 minutes while swimming or sweating (the FDA's
// water-resistance limit and the usual 2-hour guidance). It lives only on the device,
// so it works for guests and without push; the reminder is a system notification where
// the device allows one, and an in-app banner always.
//
// Free for every plan: it costs no server work (lib/plans.ts). This is the pure timer;
// the web app keeps it in localStorage (lib/reapply.ts), a native client in its own store.

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
  return { ...timer, mode }
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

/** "1 h 20 min", "45 min", "1 h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** A stored timer, or null when there is none, it is malformed, or it is too old. */
export function parseTimer(raw: unknown, now: number): ReapplyTimer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { startedAt, appliedAt, mode, notifiedFor } = raw as Record<string, unknown>
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
  if (typeof appliedAt !== 'number' || !Number.isFinite(appliedAt)) return null
  if (mode !== 'standard' && mode !== 'water') return null
  if (appliedAt < startedAt || startedAt > now || now - startedAt > REAPPLY_MAX_AGE_MS) return null
  return {
    startedAt,
    appliedAt: Math.min(appliedAt, now),
    mode,
    ...(typeof notifiedFor === 'number' && Number.isFinite(notifiedFor) ? { notifiedFor } : {}),
  }
}
