import type { Activity, Location, SafeActivityWindow } from './types'
import { fmtClock } from './weather'

export interface ActivitySharePayload {
  activity: Activity
  window: SafeActivityWindow | { from: number; to: number; peakUV?: number }
  location: Location
  dateLabel: string
  dayOffset?: number
}

export interface ParsedActivityShare {
  activity: string
  icon: string
  city: string
  region: string
  date: string
  from: number
  to: number
  uv?: string
}

export function parseActivityShareParams(params: URLSearchParams): ParsedActivityShare | null {
  const activity = params.get('a')?.trim()
  const city = params.get('city')?.trim()
  const date = params.get('date')?.trim()
  const rawFrom = params.get('from')?.trim()
  const rawTo = params.get('to')?.trim()
  const from = Number(rawFrom)
  const to = Number(rawTo)

  if (
    !activity ||
    !city ||
    !date ||
    !rawFrom ||
    !rawTo ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to > 24 ||
    to <= from
  )
    return null

  return {
    activity,
    icon: params.get('icon')?.trim() || '☀️',
    city,
    region: params.get('region')?.trim() || '',
    date,
    from,
    to,
    uv: params.get('uv')?.trim() || undefined,
  }
}

export function buildActivityShareText({
  activity,
  window: win,
  location,
  dateLabel,
}: ActivitySharePayload): string {
  const place = `${location.city}${location.region ? `, ${location.region}` : ''}`
  const uvCopy = typeof win.peakUV === 'number' ? ` Peak UV ${win.peakUV.toFixed(1)}.` : ''
  const duration =
    activity.durationMins < 60 ? `${activity.durationMins} min` : `${activity.durationMins / 60} hr`
  return `Let's do ${activity.name.toLowerCase()} ${dateLabel.toLowerCase()} from ${fmtClock(win.from)}–${fmtClock(win.to)} in ${place}. Solara estimates this as a lower-UV ${duration} planning window.${uvCopy} Recheck current conditions and use sun protection.`
}

export function buildActivityShareUrl(
  { activity, window: win, location, dateLabel, dayOffset = 0 }: ActivitySharePayload,
  origin?: string,
): string {
  const base = origin || 'https://uv-activity-planner.web.app'
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

export async function shareOrCopy(
  title: string,
  text: string,
  url: string,
): Promise<'shared' | 'copied' | 'unsupported'> {
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
