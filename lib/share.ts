import { Activity, Location, SafeActivityWindow } from './types'
import { fmtHour } from './weather'

export interface ActivitySharePayload {
  activity: Activity
  window: SafeActivityWindow | { from: number; to: number; peakUV?: number }
  location: Location
  dateLabel: string
  dayOffset?: number
}

export function buildActivityShareText({ activity, window, location, dateLabel }: ActivitySharePayload): string {
  const place = `${location.city}${location.region ? `, ${location.region}` : ''}`
  const uvCopy = typeof window.peakUV === 'number' ? ` Peak UV ${window.peakUV.toFixed(1)}.` : ''
  const duration = activity.durationMins < 60 ? `${activity.durationMins} min` : `${activity.durationMins / 60} hr`
  return `Let's do ${activity.name.toLowerCase()} ${dateLabel.toLowerCase()} from ${fmtHour(window.from)}–${fmtHour(window.to)} in ${place}. Solara says this is a safer ${duration} sun window.${uvCopy}`
}

export function buildActivityShareUrl({ activity, window, location, dateLabel, dayOffset = 0 }: ActivitySharePayload, origin?: string): string {
  const base = origin || 'https://solara.web.app'
  const params = new URLSearchParams({
    a: activity.name,
    icon: activity.icon,
    from: String(window.from),
    to: String(window.to),
    city: location.city,
    region: location.region || '',
    date: dateLabel,
    day: String(dayOffset),
  })
  if (typeof window.peakUV === 'number') params.set('uv', window.peakUV.toFixed(1))
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
