// Per-day activity planning on an hourly forecast: the safe windows for one activity,
// whether now is one, and the minutes to vitamin D. Pure, so the web app (lib/weather.ts
// re-exports it with its display helpers) and a native client plan the same way.
import type { ActivityWindow, HourlyForecast } from './forecast-days'
import { planningHours } from './forecast-quality'
import type { Activity } from './prefs'
import {
  SKIN_BURN_BASE,
  burnMins,
  effectiveMaxUV,
  findWindows,
  hourAllowed,
  lowestUVWindow,
  type SkinType,
} from './recommendation'
import type { Daylight } from './sun-times'

export function vitDMins(uv: number, skinType: SkinType): number | null {
  if (uv < 1) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.max(1, Math.round((base * 0.3 * 10) / uv))
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Short label for an activity's weekday restriction; null when it runs every day. */
export function fmtDays(days?: number[]): string | null {
  if (!days || days.length === 0 || days.length === 7) return null
  const set = new Set(days)
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  return [...days]
    .sort((a, b) => a - b)
    .map(d => DAY_ABBR[d])
    .join(', ')
}

function withinPreferredHours(hour: number, activity: Activity): boolean {
  return hourAllowed(hour, activity.preferredHours)
}

export interface ActivityWindowOptions {
  /** Skip hours with likely rain or too much heat for the activity (default true). */
  weather?: boolean
}

export function getActivityWindow(
  hourly: HourlyForecast[],
  activity: Activity,
  currentHour: number,
  skinType: SkinType = 'fair',
  /** The day's hours with the sun up (DayWeather.daylight): no window in the dark. */
  daylight: Daylight | null = null,
  { weather = true }: ActivityWindowOptions = {},
): ActivityWindow {
  const maxUV = effectiveMaxUV(activity)
  // Planning judges each hour by the UV the activity's skin is expected to get: the
  // clear-sky UV, or the forecast's (which already includes its clouds) when the
  // activity accounts for cloud cover, then its shade and surface reflection
  // (planningUV), and skips the hours its rain and heat limits rule out. The reported
  // window UV stays the forecast value.
  const planned = planningHours(hourly, activity, weather)
  const allWindows = findWindows(
    planned,
    maxUV,
    activity.durationMins,
    activity.preferredHours,
    daylight,
  )
  const best = lowestUVWindow(allWindows)

  const bestWindow = best ? { from: best.from, to: best.to } : null
  const fits = (h: (typeof planned)[number]) =>
    h.planningUV <= maxUV && !h.blocked && withinPreferredHours(h.hour, activity)
  const current = planned.find(h => h.hour === currentHour)
  const safeNow = current ? fits(current) : false
  // "% of daylight hours fit": an hour counts as daylight when the sun is up at its
  // middle, so the dark hours at either end of the forecast day count for nothing.
  const daylit = daylight
    ? planned.filter(h => h.hour + 0.5 >= daylight.from && h.hour + 0.5 < daylight.to)
    : planned
  const qualifyingHours = daylit.filter(fits).length
  const pctDaySafe = daylit.length ? Math.round((qualifyingHours / daylit.length) * 100) : 0
  const burn = burnMins(maxUV, skinType)

  return { activity, bestWindow, allWindows, safeNow, pctDaySafe, burnMins: burn }
}
