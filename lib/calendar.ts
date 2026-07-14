import { Activity } from './types'
import { effectiveMaxUV, findRecommendationWindows } from './recommendation'
export { fmtHour as fmtH } from './weather'

export interface DayForecast {
  dateStr: string
  label: string
  shortLabel: string
  hourly: { hour: number; uv: number; tempF: number }[]
}

export interface SafeWindow {
  from: number
  to: number
  peakUV: number
}

export function getSafeWindowsForActivity(hourly: DayForecast['hourly'], activity: Activity): SafeWindow[] {
  const maxUV = effectiveMaxUV(activity)
  return getSafeWindows(hourly, maxUV, activity.durationMins, activity)
}

export function getSafeWindows(hourly: DayForecast['hourly'], maxUV: number, durationMins = 0, activity?: Activity): SafeWindow[] {
  return findRecommendationWindows(hourly, maxUV, durationMins, activity?.preferredHours)
    .map(({ from, to, peakUV }) => ({ from, to, peakUV }))
}

export function gcalWindowLink(
  activity: Activity,
  window: SafeWindow,
  dateStr: string
): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const start = new Date(year, month - 1, day, window.from, 0, 0)
  const end   = new Date(year, month - 1, day, window.to,   0, 0)
  const fmt   = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const safeUV = effectiveMaxUV(activity)
  const title = encodeURIComponent(`${activity.name} — safe window`)
  const details = encodeURIComponent(
    `Safe UV window for ${activity.name}. UV stays ≤${safeUV} from ${window.from}:00–${window.to}:00${activity.sunscreen ? ' assuming SPF 30+.' : '.'} Schedule your ${activity.durationMins < 60 ? activity.durationMins + 'min' : activity.durationMins / 60 + 'hr'} session anywhere in this range.`
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`
}


export function uvBg(uv: number): string {
  if (uv < 0.5) return 'rgba(209,213,219,0.3)'
  if (uv <= 2)  return 'rgba(134,239,172,0.35)'
  if (uv <= 5)  return 'rgba(252,211,77,0.35)'
  if (uv <= 7)  return 'rgba(251,146,60,0.35)'
  if (uv <= 10) return 'rgba(248,113,113,0.35)'
  return 'rgba(192,132,252,0.35)'
}
