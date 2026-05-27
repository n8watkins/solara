import { HourlyForecast, Activity, ActivityWindow, SkinType } from './types'

export const SKIN_BURN_BASE: Record<SkinType, number> = {
  'very-fair': 10,
  'fair':      15,
  'medium':    25,
  'olive':     35,
  'dark':      50,
}

export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'break', name: 'Quick sun break', icon: '☀️', durationMins: 5,   maxUV: 8 },
  { id: 'walk',  name: 'Walking',         icon: '🚶', durationMins: 30,  maxUV: 5 },
  { id: 'run',   name: 'Running',         icon: '🏃', durationMins: 45,  maxUV: 4 },
  { id: 'swim',  name: 'Swimming',        icon: '🏊', durationMins: 60,  maxUV: 3 },
  { id: 'hike',  name: 'Hiking',          icon: '🥾', durationMins: 120, maxUV: 3 },
  { id: 'golf',  name: 'Golf',            icon: '⛳', durationMins: 240, maxUV: 2 },
]

export function burnMins(uv: number, skinType: SkinType): number | null {
  if (uv < 0.5) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.round((base * 10) / uv)
}

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
  const title = encodeURIComponent(`${activityName} — sun window`)
  const details = encodeURIComponent('Scheduled by Solara — safe UV window for your skin type.')
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`
}

export function getActivityWindow(
  hourly: HourlyForecast[],
  activity: Activity,
  currentHour: number
): ActivityWindow {
  let start: number | null = null
  let bestWindow: { from: number; to: number } | null = null
  let safeCount = 0

  for (let i = 0; i < hourly.length; i++) {
    const { hour, uv } = hourly[i]
    if (uv <= activity.maxUV) {
      safeCount++
      if (start === null) start = hour
    } else {
      if (start !== null) {
        if ((hour - start) * 60 >= activity.durationMins && !bestWindow) {
          bestWindow = { from: start, to: hour }
        }
        start = null
      }
    }
  }
  if (start !== null && !bestWindow) {
    const last = hourly[hourly.length - 1].hour + 1
    if ((last - start) * 60 >= activity.durationMins) {
      bestWindow = { from: start, to: last }
    }
  }

  const currentUV = hourly.find(h => h.hour === currentHour)?.uv ?? 0
  const safeNow = currentUV <= activity.maxUV
  const pctDaySafe = Math.round((safeCount / hourly.length) * 100)
  const burn = burnMins(activity.maxUV, 'fair')

  return { activity, bestWindow, safeNow, pctDaySafe, burnMins: burn }
}
