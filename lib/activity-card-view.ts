// Pure view logic for one activity card (components/dashboard/ActivityCard.tsx):
// its status badge, labels and whether its recommendation is already scheduled.
import type { ActivityDayPlan } from './next-slot'
import type { ScheduledSpan } from './scheduled'
import type { SlotRecommendation } from './scheduler'

export type ActivityStatus = 'safe' | 'caution' | 'avoid'

/**
 * The badge describes the recommendation below it, never a window that cannot
 * be finished or has already passed.
 */
export function activityBadge(
  plan: Pick<ActivityDayPlan, 'startsNow' | 'slot' | 'elapsed'>,
  isToday: boolean,
): { status: ActivityStatus; label: string } {
  if (plan.startsNow) return { status: 'safe', label: 'Now' }
  if (plan.slot) return { status: 'caution', label: isToday ? 'Later' : 'Available' }
  return { status: 'avoid', label: plan.elapsed ? 'None left' : 'No match' }
}

/** "45m", "1h", "1.5h". */
export function durationLabel(mins: number): string {
  return mins < 60 ? `${mins}m` : `${mins / 60}h`
}

/** The "Best window" row: the window's range, or why there is none. */
export function bestWindowLabel(
  plan: Pick<ActivityDayPlan, 'bestWindow' | 'elapsed'>,
  isToday: boolean,
  formatTime: (hour: number) => string,
): string {
  const { bestWindow } = plan
  if (bestWindow) return `${formatTime(bestWindow.from)}–${formatTime(bestWindow.to)}`
  if (plan.elapsed) return 'None left today'
  return isToday ? 'None today' : 'None'
}

/** Tone of the "% of visible day matches" bar. */
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
