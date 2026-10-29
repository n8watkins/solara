// The single "next actionable slot" calculation for a day.
//
// Every dashboard surface that recommends a time (the hero, the activity cards,
// "Best day this week" and the share buttons) goes through `planActivityDay`, so
// they can never disagree. A slot is actionable when it:
//   - starts no earlier than "now" on today (elapsed windows are dropped and a
//     window already under way is trimmed to start now),
//   - ends inside the forecast day the UV strip shows (the last hourly sample;
//     the engine in @solara/core already ends every window there),
//   - is long enough for the activity,
//   - lies in daylight: between the place's sunrise and sunset on that day (Solara plans
//     outdoor time in daylight only; the UV of 0 in the dark is not a "lower-UV slot").
import type { HourlyForecast, SafeActivityWindow } from './forecast-days'
import { planningUV } from './forecast-quality'
import type { Activity } from './prefs'
import { effectiveMaxUV, lowestUVWindow, summarizeWindow, type SkinType } from './recommendation'
import type { Daylight } from './sun-times'
import { getActivityWindow } from './weather'
import type { BusyInterval, SlotRecommendation } from './scheduler'
import { recommendSlot } from './scheduler'

/** Minutes "now" is rounded up to, so a 10:32 visit offers a 10:35 start. */
const NOW_STEP_MINUTES = 5

/**
 * The current time as fractional hours, rounded up to a 5-minute step. Pass the
 * forecast location's wall clock (lib/time.ts zonedNow), never the device's.
 * Use the result as `nowHour` for today; future days use -1.
 */
export function nowHourOf(now: { hour: number; minute: number }): number {
  const minutes = now.hour * 60 + now.minute
  return (Math.ceil(minutes / NOW_STEP_MINUTES) * NOW_STEP_MINUTES) / 60
}

/**
 * Trim safe windows to what is still actionable: from `nowHour` (today; -1 for
 * other days), keeping only spans that still fit the activity. Trimmed windows
 * get their label and UV stats recomputed.
 */
export function actionableWindows(
  windows: SafeActivityWindow[],
  hourly: HourlyForecast[],
  durationMins: number,
  nowHour = -1,
): SafeActivityWindow[] {
  const result: SafeActivityWindow[] = []
  for (const w of windows) {
    const from = nowHour >= 0 ? Math.max(w.from, nowHour) : w.from
    if (w.to <= from || (w.to - from) * 60 < durationMins) continue
    result.push(from === w.from ? w : summarizeWindow(hourly, from, w.to))
  }
  return result
}

/** Lowest-average-UV window, ties broken toward the longer one, then the earlier one. */
export { lowestUVWindow }

export interface ActivityDayPlan {
  activity: Activity
  /** Actionable windows for the day, in time order. */
  windows: SafeActivityWindow[]
  /** The lowest-UV actionable window, or null. */
  bestWindow: SafeActivityWindow | null
  /** The recommended slot (honoring time preference and calendar), or null. */
  slot: SlotRecommendation | null
  /** True when the recommended slot starts now (today only). */
  startsNow: boolean
  /** True when the day had matching windows but all of them have already passed. */
  elapsed: boolean
  /**
   * True when the activity's preferred hours leave too little daylight for it on this
   * day (a 5-7am run in winter): it gets no slot because of the dark, not the UV.
   */
  hoursInDark: boolean
  /** Share of the day's daylight hours under the activity's limit (for context). */
  pctDaySafe: number
  /** Burn estimate at the activity's planning UV limit. */
  burnMins: number | null
  /**
   * For each of `windows`: it holds only if the forecast clouds do (the activity
   * accounts for cloud cover and a clear sky would put an hour over its limit).
   */
  cloudDependent: boolean[]
}

/**
 * Whether a window for a cloud-sensitive activity holds only under the forecast's
 * clouds: some hour in it would be over the limit under a clear sky.
 */
export function needsClouds(
  win: { from: number; to: number },
  hourly: HourlyForecast[],
  activity: Activity,
): boolean {
  if (!activity.cloudSensitive) return false
  const clearSky = { ...activity, cloudSensitive: false }
  const limit = effectiveMaxUV(activity)
  return hourly.some(
    h => h.hour >= Math.floor(win.from) && h.hour < win.to && planningUV(h, clearSky) > limit,
  )
}

/** Whether the activity's preferred hours overlap the day's daylight for less than its duration. */
function hoursInDark(activity: Activity, daylight: Daylight | null): boolean {
  const hours = activity.preferredHours
  if (!hours || !daylight) return false
  const overlap = Math.min(hours.to, daylight.to) - Math.max(hours.from, daylight.from)
  return overlap * 60 < Math.max(activity.durationMins, 1)
}

export interface PlanOptions {
  /** Fractional current hour for today (see nowHourOf); -1 for any other day. */
  nowHour?: number
  /** Calendar busy blocks for the day. */
  busy?: BusyInterval[]
  /**
   * The day's hours with the sun up (DayWeather.daylight): no slot starts before sunrise
   * or ends after sunset, though the UV there is 0. Null when the place is unknown.
   */
  daylight?: Daylight | null
}

/** The one recommendation for an activity on one day. */
export function planActivityDay(
  hourly: HourlyForecast[],
  activity: Activity,
  skinType: SkinType,
  { nowHour = -1, busy = [], daylight = null }: PlanOptions = {},
): ActivityDayPlan {
  const { allWindows, pctDaySafe, burnMins } = getActivityWindow(
    hourly,
    activity,
    -1,
    skinType,
    daylight,
  )
  const windows = actionableWindows(allWindows, hourly, activity.durationMins, nowHour)
  const slot = recommendSlot(
    windows,
    busy,
    activity.durationMins,
    activity.timePreference ?? 'earliest',
    -1,
    hourly,
  )
  const elapsed =
    nowHour >= 0 &&
    windows.length === 0 &&
    actionableWindows(allWindows, hourly, activity.durationMins).length > 0
  return {
    activity,
    windows,
    bestWindow: lowestUVWindow(windows),
    slot,
    startsNow: !!slot && nowHour >= 0 && slot.start <= nowHour,
    elapsed,
    hoursInDark: hoursInDark(activity, daylight),
    pctDaySafe,
    burnMins,
    cloudDependent: windows.map(w => needsClouds(w, hourly, activity)),
  }
}

/**
 * The hero pick for a day: the activity whose recommended slot starts soonest
 * (ties keep the user's activity order). Null when no activity has a slot.
 */
export function soonestPlan(plans: ActivityDayPlan[]): ActivityDayPlan | null {
  let best: ActivityDayPlan | null = null
  for (const p of plans) {
    if (!p.slot) continue
    if (!best || p.slot.start < best.slot!.start) best = p
  }
  return best
}
