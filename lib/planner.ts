import { DayWeather, Activity, SkinType, SafeActivityWindow } from './types'
import { getActivityWindow } from './weather'

export interface UpcomingWindow {
  activity: Activity
  dateStr: string
  label: string
  dayOffset: number
  window: SafeActivityWindow
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
