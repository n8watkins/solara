import type { HourlyForecast, Activity, ActivityWindow, SafeActivityWindow, SkinType } from './types'
import { burnMins, effectiveMaxUV, findRecommendationWindows } from './recommendation'
import { cloudAdjustedUV } from './exposure'

export { burnMins, SKIN_BURN_BASE } from './recommendation'
import { SKIN_BURN_BASE } from './recommendation'

export function vitDMins(uv: number, skinType: SkinType): number | null {
  if (uv < 1) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.max(1, Math.round((base * 0.3 * 10) / uv))
}

export function uvLabel(uv: number): string {
  if (uv < 0.5) return 'None'
  if (uv <= 2)  return 'Low'
  if (uv <= 5)  return 'Moderate'
  if (uv <= 7)  return 'High'
  if (uv <= 10) return 'Very high'
  return 'Extreme'
}

export function uvColorHex(uv: number): string {
  if (uv < 0.5) return '#D1D5DB'
  if (uv <= 2)  return '#86EFAC'
  if (uv <= 5)  return '#FCD34D'
  if (uv <= 7)  return '#FB923C'
  if (uv <= 10) return '#F87171'
  return '#C084FC'
}

export function uvTextHex(uv: number): string {
  if (uv < 0.5) return '#374151'
  if (uv <= 2)  return '#14532D'
  if (uv <= 5)  return '#78350F'
  if (uv <= 7)  return '#7C2D12'
  if (uv <= 10) return '#7F1D1D'
  return '#4A044E'
}

export function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

// UV values display with one decimal everywhere; `compact` drops the decimal at
// double digits so the value fits the ~22px mobile timeline bars.
export function formatUV(uv: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && uv >= 10) return String(Math.round(uv))
  return uv.toFixed(1)
}

// Like fmtHour but supports fractional hours: 6.75 → "6:45am", 17 → "5pm".
export function fmtClock(h: number): string {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) { hr += 1; min = 0 }
  const base = fmtHour(hr)
  if (min === 0) return base
  const m = base.match(/^(\d+)(am|pm)$/)
  return m ? `${m[1]}:${String(min).padStart(2, '0')}${m[2]}` : base
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Short label for an activity's weekday restriction; null when it runs every day. */
export function fmtDays(days?: number[]): string | null {
  if (!days || days.length === 0 || days.length === 7) return null
  const set = new Set(days)
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  return [...days].sort((a, b) => a - b).map(d => DAY_ABBR[d]).join(', ')
}

export function gcalLink(
  activityName: string,
  window: { from: number; to: number },
  durationMins: number,
  daysFromNow = 0
): string {
  const base = new Date()
  base.setDate(base.getDate() + daysFromNow)
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), window.from, 0, 0)
  const end = new Date(start.getTime() + durationMins * 60000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const title = encodeURIComponent(`${activityName}: lower-UV window`)
  const details = encodeURIComponent('Forecast-based lower-UV planning estimate from Solara. Recheck current UV and use sun protection.')
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`
}

function withinPreferredHours(hour: number, activity: Activity): boolean {
  if (!activity.preferredHours) return true
  return hour >= activity.preferredHours.from && hour < activity.preferredHours.to
}

export function getActivityWindow(
  hourly: HourlyForecast[],
  activity: Activity,
  currentHour: number,
  skinType: SkinType = 'fair'
): ActivityWindow {
  const maxUV = effectiveMaxUV(activity)
  // Cloud-sensitive activities judge safety against UV discounted by cloud cover; the
  // reported window UV (summarizeSafeWindow) stays the true forecast value.
  const exposureUV = (h: HourlyForecast) =>
    activity.cloudSensitive ? cloudAdjustedUV(h.uv, h.cloudCover) : h.uv
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
  const best = allWindows
    .slice()
    .sort((a, b) => (a.avgUV - b.avgUV) || ((b.to - b.from) - (a.to - a.from)))[0] ?? null

  const bestWindow = best ? { from: best.from, to: best.to } : null
  const current = hourly.find(h => h.hour === currentHour)
  const safeNow = current ? exposureUV(current) <= maxUV && withinPreferredHours(current.hour, activity) : false
  const qualifyingHours = hourly.filter(hour =>
    exposureUV(hour) <= maxUV && withinPreferredHours(hour.hour, activity)
  ).length
  const pctDaySafe = hourly.length ? Math.round((qualifyingHours / hourly.length) * 100) : 0
  const burn = burnMins(maxUV, skinType)

  return { activity, bestWindow, allWindows, safeNow, pctDaySafe, burnMins: burn }
}
