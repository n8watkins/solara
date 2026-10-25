// Where scheduled activities fall on screen: the pure helpers the dashboard and
// calendar draw with. lib/scheduled.ts (Firestore storage and Google reconciliation,
// loaded for someone signed in) re-exports them.
import type { ScheduledActivity } from '@solara/core'
import { zonedInstant, zonedNow } from './time'
import type { SafeActivityWindow } from './types'

export type { ScheduledActivity }

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
