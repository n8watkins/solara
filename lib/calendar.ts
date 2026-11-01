import { windowEventTitle } from '@solara/core'
import { formatDuration } from '@solara/core/duration'
import type { Activity } from './types'
import { effectiveMaxUV, findRecommendationWindows } from './recommendation'
import { fmtClock, gcalTimestamp } from './weather'
import { zonedInstant } from './time'
import m from '@/messages/activities'
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
    m.calendarDetails(
      activity.name,
      planningUVLimit,
      fmtClock(window.from),
      fmtClock(window.to),
      !!activity.sunscreen,
      formatDuration(activity.durationMins),
    ),
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gcalTimestamp(start)}/${gcalTimestamp(end)}&details=${details}`
}
