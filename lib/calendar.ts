import { windowEventTitle } from '@solara/core'
import type { Activity } from './types'
import { effectiveMaxUV, findRecommendationWindows } from './recommendation'
import { fmtClock, gcalTimestamp } from './weather'
import { zonedInstant } from './time'
export { fmtHour as fmtH } from './weather'

type UVHour = { hour: number; uv: number }

export interface SafeWindow {
  from: number
  to: number
  peakUV: number
}

export function getSafeWindowsForActivity(hourly: UVHour[], activity: Activity): SafeWindow[] {
  const maxUV = effectiveMaxUV(activity)
  return getSafeWindows(hourly, maxUV, activity.durationMins, activity)
}

export function getSafeWindows(
  hourly: UVHour[],
  maxUV: number,
  durationMins = 0,
  activity?: Activity,
): SafeWindow[] {
  return findRecommendationWindows(hourly, maxUV, durationMins, activity?.preferredHours).map(
    ({ from, to, peakUV }) => ({ from, to, peakUV }),
  )
}

/**
 * A Google Calendar link for a whole window on `dateStr`, in the forecast
 * location's `timeZone` (fractional hours keep their minutes).
 */
export function gcalWindowLink(
  activity: Activity,
  window: SafeWindow,
  dateStr: string,
  timeZone: string,
): string {
  const start = zonedInstant(dateStr, window.from, timeZone)
  const end = zonedInstant(dateStr, window.to, timeZone)
  const planningUVLimit = effectiveMaxUV(activity)
  const title = encodeURIComponent(windowEventTitle(activity.name))
  const details = encodeURIComponent(
    `Estimated lower-UV window for ${activity.name}. Forecast UV stays at or below the planning limit of ${planningUVLimit} from ${fmtClock(window.from)}–${fmtClock(window.to)}${activity.sunscreen ? ' assuming SPF 30+.' : '.'} Schedule your ${activity.durationMins < 60 ? activity.durationMins + 'min' : activity.durationMins / 60 + 'hr'} session in this range. Recheck conditions and use sun protection; this is not medical advice.`,
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gcalTimestamp(start)}/${gcalTimestamp(end)}&details=${details}`
}

export function uvBg(uv: number): string {
  if (uv < 0.5) return 'rgba(209,213,219,0.3)'
  if (uv <= 2) return 'rgba(134,239,172,0.35)'
  if (uv <= 5) return 'rgba(252,211,77,0.35)'
  if (uv <= 7) return 'rgba(251,146,60,0.35)'
  if (uv <= 10) return 'rgba(248,113,113,0.35)'
  return 'rgba(192,132,252,0.35)'
}
