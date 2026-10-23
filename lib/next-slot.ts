// The single "next actionable slot" calculation for a day.
//
// Every dashboard surface that recommends a time (the hero, the activity cards,
// "Best day this week" and the share buttons) goes through `planActivityDay`, so
// they can never disagree. A slot is actionable when it:
//   - starts no earlier than "now" on today (elapsed windows are dropped and a
//     window already under way is trimmed to start now),
//   - ends inside the forecast day the UV strip shows (the last hourly sample),
//   - is long enough for the activity.
import { lowestUVWindow, summarizeWindow } from '@solara/core'
import type { Activity, HourlyForecast, SafeActivityWindow, SkinType } from './types'
import { getActivityWindow } from './weather'
import type { BusyInterval, SlotRecommendation } from './scheduler'
import { recommendSlot } from './scheduler'

/** Minutes "now" is rounded up to, so a 10:32 visit offers a 10:35 start. */
const NOW_STEP_MINUTES = 5

/**
 * The current local time as fractional hours, rounded up to a 5-minute step.
 * Pass the result as `nowHour` for today; future days use -1.
 */
export function nowHourOf(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes()
  return (Math.ceil(minutes / NOW_STEP_MINUTES) * NOW_STEP_MINUTES) / 60
}

/**
 * Trim safe windows to what is still actionable: from `nowHour` (today; -1 for
 * other days) to the last hourly sample, keeping only spans that still fit the
 * activity. Trimmed windows get their label and UV stats recomputed.
 */
export function actionableWindows(
  windows: SafeActivityWindow[],
  hourly: HourlyForecast[],
  durationMins: number,
  nowHour = -1,
): SafeActivityWindow[] {
  const dayEnd = hourly.at(-1)?.hour
  if (dayEnd === undefined) return []
  const result: SafeActivityWindow[] = []
  for (const w of windows) {
    const from = nowHour >= 0 ? Math.max(w.from, nowHour) : w.from
    const to = Math.min(w.to, dayEnd)
    if (to <= from || (to - from) * 60 < durationMins) continue
    result.push(from === w.from && to === w.to ? w : summarizeWindow(hourly, from, to))
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
  /** Share of the day's hours under the activity's limit (whole day, for context). */
  pctDaySafe: number
  /** Burn estimate at the activity's planning UV limit. */
  burnMins: number | null
}

export interface PlanOptions {
  /** Fractional current hour for today (see nowHourOf); -1 for any other day. */
  nowHour?: number
  /** Calendar busy blocks for the day. */
  busy?: BusyInterval[]
}

/** The one recommendation for an activity on one day. */
export function planActivityDay(
  hourly: HourlyForecast[],
  activity: Activity,
  skinType: SkinType,
  { nowHour = -1, busy = [] }: PlanOptions = {},
): ActivityDayPlan {
  const { allWindows, pctDaySafe, burnMins } = getActivityWindow(hourly, activity, -1, skinType)
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
    pctDaySafe,
    burnMins,
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
