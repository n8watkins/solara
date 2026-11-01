// Pure view logic for one activity card (components/dashboard/ActivityCard.tsx):
// its status badge, labels and whether its recommendation is already scheduled.
import type { ActivityDayPlan } from '@solara/core/next-slot'
import type { ScheduledSpan } from './scheduled'
import type { SlotRecommendation } from '@solara/core/scheduler'
import { timeRange } from './time'
import m from '@/messages/activities'

export type ActivityStatus = 'safe' | 'caution' | 'avoid' | 'done'

/**
 * The badge describes the recommendation below it, never a window that cannot
 * be finished or has already passed. A day whose windows have all passed is
 * simply done: neutral, not a red warning.
 */
export function activityBadge(
  plan: Pick<ActivityDayPlan, 'startsNow' | 'slot' | 'elapsed'>,
  isToday: boolean,
): { status: ActivityStatus; label: string } {
  if (plan.startsNow) return { status: 'safe', label: m.badgeNow }
  if (plan.slot) return { status: 'caution', label: isToday ? m.badgeLater : m.badgeAvailable }
  if (plan.elapsed) return { status: 'done', label: m.doneForToday }
  return { status: 'avoid', label: m.badgeNoMatch }
}

/**
 * The "Best window" row: the window's range, or why there is none. Null once
 * today's windows have passed: the "Done for today" badge says so, and the row
 * is left out rather than saying it again.
 */
export function bestWindowLabel(
  plan: Pick<ActivityDayPlan, 'bestWindow' | 'elapsed'>,
  isToday: boolean,
  formatTime: (hour: number) => string,
): string | null {
  const { bestWindow } = plan
  if (bestWindow) return timeRange(formatTime(bestWindow.from), formatTime(bestWindow.to))
  if (plan.elapsed) return null
  return isToday ? m.noneToday : m.none
}

/** Tone of the "% of daylight hours fit" bar. */
export function matchTone(pctDaySafe: number): 'success' | 'warning' | 'danger' {
  if (pctDaySafe >= 60) return 'success'
  if (pctDaySafe >= 30) return 'warning'
  return 'danger'
}

/** True when a scheduled event overlaps the recommendation, which it then replaces. */
export function isRecommendationScheduled(
  rec: Pick<SlotRecommendation, 'start' | 'end'> | null,
  scheduled: { span: Pick<ScheduledSpan, 'from' | 'to'> }[],
): boolean {
  return !!rec && scheduled.some(({ span }) => span.from < rec.end && span.to > rec.start)
}

/**
 * The period that closes a sentence ending in `last`, or nothing when `last` already ends
 * in one: a Spanish time ends in an abbreviation ("7:15 p.m."), whose period closes the
 * sentence too.
 */
export function closingPeriod(last: string): '.' | '' {
  return last.endsWith('.') ? '' : '.'
}
