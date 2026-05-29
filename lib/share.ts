import { Activity, Location, SafeActivityWindow } from './types'
import { fmtHour } from './weather'

export interface ActivitySharePayload {
  activity: Activity
  window: SafeActivityWindow | { from: number; to: number; peakUV?: number }
  location: Location
  dateLabel: string
  dayOffset?: number
}

export function buildActivityShareText({ activity, window: win, location, dateLabel }: ActivitySharePayload): string {
  const place = `${location.city}${location.region ? `, ${location.region}` : ''}`
  const uvCopy = typeof win.peakUV === 'number' ? ` Peak UV ${win.peakUV.toFixed(1)}.` : ''
  const duration = activity.durationMins < 60 ? `${activity.durationMins} min` : `${activity.durationMins / 60} hr`
  return `Let's do ${activity.name.toLowerCase()} ${dateLabel.toLowerCase()} from ${fmtHour(win.from)}–${fmtHour(win.to)} in ${place}. Solara says this is a safer ${duration} sun window.${uvCopy}`
}

export function buildActivityShareUrl({ activity, window: win, location, dateLabel, dayOffset = 0 }: ActivitySharePayload, origin?: string): string {
  const base = origin || 'https://solara.web.app'
  const params = new URLSearchParams({
    a: activity.name,
    icon: activity.icon,
    from: String(win.from),
    to: String(win.to),
    city: location.city,
    region: location.region || '',
    date: dateLabel,
    day: String(dayOffset),
  })
  if (typeof win.peakUV === 'number') params.set('uv', win.peakUV.toFixed(1))
  return `${base}/share?${params.toString()}`
}

export async function shareOrCopy(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'unsupported'> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share({ title, text, url })
    return 'shared'
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(`${text} ${url}`.trim())
    return 'copied'
  }
  return 'unsupported'
}
