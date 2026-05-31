import { DayWeather, Activity, SkinType, SafeActivityWindow } from './types'
import { getActivityWindow } from './weather'
import { recommendSlot, SlotRecommendation, BusyInterval } from './scheduler'

export interface UpcomingWindow {
  activity: Activity
  dateStr: string
  label: string
  dayOffset: number
  window: SafeActivityWindow
}

/**
 * Whether an activity's weekday restriction includes the given calendar date.
 * `dateStr` is 'YYYY-MM-DD'; weekday is read at local noon to dodge DST edges.
 * No restriction (undefined/empty) means it runs every day.
 */
export function activityRunsOn(activity: Activity, dateStr: string): boolean {
  if (!activity.daysOfWeek || activity.daysOfWeek.length === 0) return true
  const weekday = new Date(dateStr + 'T12:00:00').getDay()
  return activity.daysOfWeek.includes(weekday)
}

/** The lowest-average-UV window on a single day (ties broken by longer window). */
function bestWindowOfDay(windows: SafeActivityWindow[]): SafeActivityWindow | null {
  if (!windows.length) return null
  return windows
    .slice()
    .sort((a, b) => (a.avgUV - b.avgUV) || ((b.to - b.from) - (a.to - a.from)))[0]
}

/**
 * Across the accessible forecast horizon, find the single best safe window for
 * an activity — the lowest-average-UV window, breaking ties toward the earliest
 * day. Returns null if no day in range has a window long enough for the activity.
 *
 * This is the core "best day this week for X" recommendation. A longer forecast
 * horizon (Pro) strictly increases the planning value, since more candidate days
 * are considered.
 */
export function bestUpcomingWindow(
  forecast: DayWeather[],
  activity: Activity,
  skinType: SkinType,
  dayLimit: number,
): UpcomingWindow | null {
  let best: UpcomingWindow | null = null
  const days = forecast.slice(0, Math.max(0, dayLimit))

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    if (!day.hourly.length) continue
    if (!activityRunsOn(activity, day.dateStr)) continue
    const { allWindows } = getActivityWindow(day.hourly, activity, -1, skinType)
    const dayBest = bestWindowOfDay(allWindows)
    if (!dayBest) continue

    // Strictly-lower avgUV replaces; equal keeps the earlier day (we iterate in order).
    if (!best || dayBest.avgUV < best.window.avgUV) {
      best = { activity, dateStr: day.dateStr, label: day.label, dayOffset: i, window: dayBest }
    }
  }
  return best
}

/** Best upcoming window for each activity, omitting activities with no window in range. */
export function planUpcoming(
  forecast: DayWeather[],
  activities: Activity[],
  skinType: SkinType,
  dayLimit: number,
): UpcomingWindow[] {
  return activities
    .map(a => bestUpcomingWindow(forecast, a, skinType, dayLimit))
    .filter((w): w is UpcomingWindow => w !== null)
}

export interface UpcomingSlot {
  activity: Activity
  dateStr: string
  label: string
  dayOffset: number
  slot: SlotRecommendation
}

/**
 * Best upcoming day AND concrete time for an activity: runs recommendSlot per day
 * across the horizon (respecting each day's calendar busy + the activity's
 * timePreference), then picks the best day.
 *
 * Day selection mirrors timePreference: 'sunniest' picks the day with the
 * highest-avg-UV recommended slot; 'earliest'/'latest' pick the soonest feasible
 * day (you want to do it soon). Ties break toward the earlier day.
 */
export function bestUpcomingSlot(
  forecast: DayWeather[],
  activity: Activity,
  skinType: SkinType,
  dayLimit: number,
  busyByDate: Record<string, BusyInterval[]> = {},
  nowHourToday = -1,
): UpcomingSlot | null {
  const pref = activity.timePreference ?? 'earliest'
  const days = forecast.slice(0, Math.max(0, dayLimit))
  let best: UpcomingSlot | null = null

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    if (!day.hourly.length) continue
    if (!activityRunsOn(activity, day.dateStr)) continue
    const { allWindows } = getActivityWindow(day.hourly, activity, -1, skinType)
    const busy = busyByDate[day.dateStr] ?? []
    const slot = recommendSlot(allWindows, busy, activity.durationMins, pref, i === 0 ? nowHourToday : -1, day.hourly)
    if (!slot) continue

    const candidate: UpcomingSlot = { activity, dateStr: day.dateStr, label: day.label, dayOffset: i, slot }
    if (!best) {
      best = candidate
    } else if (pref === 'sunniest') {
      if (slot.avgUV > best.slot.avgUV) best = candidate // strictly sunnier; ties keep earlier day
    }
    // earliest/latest: keep the first feasible (soonest) day
  }
  return best
}

/** Best upcoming day+slot per activity, omitting activities with no feasible slot in range. */
export function planUpcomingSlots(
  forecast: DayWeather[],
  activities: Activity[],
  skinType: SkinType,
  dayLimit: number,
  busyByDate: Record<string, BusyInterval[]> = {},
  nowHourToday = -1,
): UpcomingSlot[] {
  return activities
    .map(a => bestUpcomingSlot(forecast, a, skinType, dayLimit, busyByDate, nowHourToday))
    .filter((s): s is UpcomingSlot => s !== null)
}
