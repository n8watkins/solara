import {
  hourAllowed,
  planningUV,
  lowestUVWindow,
  uvBand,
  windowEventTitle,
  type UVBand,
} from '@solara/core'
import type { HourlyForecast, Activity, ActivityWindow, SkinType } from './types'
import { burnMins, effectiveMaxUV, findRecommendationWindows } from './recommendation'
import { zonedInstant } from './time'

/** 12-hour hour and time labels; components use useUnits() for the person's clock. */
export { formatHour as fmtHour, formatClockTime as fmtClock } from './units'

export { burnMins, SKIN_BURN_BASE } from './recommendation'
import { SKIN_BURN_BASE } from './recommendation'

export function vitDMins(uv: number, skinType: SkinType): number | null {
  if (uv < 1) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.max(1, Math.round((base * 0.3 * 10) / uv))
}

/** The WHO UV scale lives in @solara/core so briefings and alerts name levels the same. */
export { UV_BANDS, uvBand, uvLabel, type UVBand } from '@solara/core'

/**
 * The fill color of a UV value's band, as a CSS value for inline styles and SVG.
 * The palette itself is defined once, as the --color-uv-* theme variables in
 * app/globals.css; this only picks the variable.
 */
export function uvColor(uv: number): string {
  return uvBandColor(uvBand(uv))
}

/** The fill color of a UV band, as a CSS value (see uvColor). */
export function uvBandColor(band: UVBand): string {
  return `var(--color-uv-${band})`
}

/**
 * Text color on a UV fill (uvColor). Every fill is a light tint, so one
 * near-black (--color-uv-ink) reads at 4.5:1 or better on all of them, in both
 * themes.
 */
export function uvTextColor(_uv: number): string {
  return 'var(--color-uv-ink)'
}

// UV values display with one decimal everywhere; `compact` drops the decimal at
// double digits so the value fits the ~22px mobile timeline bars.
export function formatUV(uv: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && uv >= 10) return String(Math.round(uv))
  return uv.toFixed(1)
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

/** Google Calendar's compact UTC timestamp, e.g. 20260615T173000Z. */
export function gcalTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/**
 * A Google Calendar "add event" link for a slot on `dateStr`, starting at the
 * fractional hour `window.from` in the forecast location's `timeZone`, so the event
 * lands at the right moment whatever zone the device is in.
 */
export function gcalLink(
  activityName: string,
  window: { from: number; to: number },
  durationMins: number,
  dateStr: string,
  timeZone: string,
): string {
  const start = zonedInstant(dateStr, window.from, timeZone)
  const end = start + Math.round(durationMins) * 60_000
  const title = encodeURIComponent(windowEventTitle(activityName))
  const details = encodeURIComponent(
    'Forecast-based lower-UV planning estimate from Solara. Recheck current UV and use sun protection.',
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gcalTimestamp(start)}/${gcalTimestamp(end)}&details=${details}`
}

function withinPreferredHours(hour: number, activity: Activity): boolean {
  return hourAllowed(hour, activity.preferredHours)
}

export function getActivityWindow(
  hourly: HourlyForecast[],
  activity: Activity,
  currentHour: number,
  skinType: SkinType = 'fair',
): ActivityWindow {
  const maxUV = effectiveMaxUV(activity)
  // Planning judges each hour by the UV the activity's skin is expected to get: the
  // clear-sky UV, or the forecast's (which already includes its clouds) when the
  // activity accounts for cloud cover, then its shade and surface reflection
  // (@solara/core planningUV). The reported window UV stays the forecast value.
  const exposureUV = (h: HourlyForecast) => planningUV(h, activity)
  const planningHours = hourly.map(hour => ({
    ...hour,
    planningUV: exposureUV(hour),
  }))
  const allWindows = findRecommendationWindows(
    planningHours,
    maxUV,
    activity.durationMins,
    activity.preferredHours,
  )
  const best = lowestUVWindow(allWindows)

  const bestWindow = best ? { from: best.from, to: best.to } : null
  const current = hourly.find(h => h.hour === currentHour)
  const safeNow = current
    ? exposureUV(current) <= maxUV && withinPreferredHours(current.hour, activity)
    : false
  const qualifyingHours = hourly.filter(
    hour => exposureUV(hour) <= maxUV && withinPreferredHours(hour.hour, activity),
  ).length
  const pctDaySafe = hourly.length ? Math.round((qualifyingHours / hourly.length) * 100) : 0
  const burn = burnMins(maxUV, skinType)

  return { activity, bestWindow, allWindows, safeNow, pctDaySafe, burnMins: burn }
}
