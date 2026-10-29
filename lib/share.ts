import { formatUV } from '@solara/core'
import { SITE_URL } from './site'
import type { Activity, Location, SafeActivityWindow } from './types'
import { formatClockTime } from './units'
import type { ClockFormat } from './units'

export interface ActivitySharePayload {
  activity: Activity
  window: SafeActivityWindow | { from: number; to: number; peakUV?: number }
  location: Location
  dateLabel: string
  /** Days from today; used for the link's date when `isoDate` is not given. */
  dayOffset?: number
  /** The plan's calendar date (YYYY-MM-DD). Preferred over `dayOffset`. */
  isoDate?: string
}

export interface ParsedActivityShare {
  activity: string
  icon: string
  city: string
  region: string
  /** Calendar date of the plan, YYYY-MM-DD. */
  date: string
  from: number
  to: number
  uv?: string
}

// Share links put sender-written text on the Solara origin, so every field is
// bounded and filtered: no links, addresses or phone numbers, no control or
// bidirectional-override characters, short lengths, and a strict date format.
export const SHARE_LIMITS = {
  activity: 60,
  place: 80,
  digits: 6,
  icon: 16,
} as const

export const DEFAULT_SHARE_ICON = '☀️'

// Letters, marks, numbers, spaces and the punctuation real activity and place
// names use. No slash, colon or at sign, so no URLs or email addresses.
const DISALLOWED_TEXT_CHARS = /[^\p{L}\p{M}\p{N}\p{Zs}.,'’&()!-]/gu
const DOMAIN_LIKE = /[\p{L}\p{N}-]+\.[\p{L}]{2,}/u
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const HOUR = /^\d{1,2}(\.\d{1,4})?$/
const UV = /^\d{1,2}(\.\d)?$/
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

function countCodePoints(value: string): number {
  return Array.from(value).length
}

/**
 * Normalize sender text to the allowed character set: compatibility forms are
 * folded, anything outside the allowlist becomes a space, runs of whitespace
 * collapse and the result is trimmed and capped at `max` characters.
 */
export function sanitizeShareText(value: string, max: number): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(DISALLOWED_TEXT_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(cleaned).slice(0, max).join('').trim()
}

function isSafeShareText(value: string): boolean {
  if (DOMAIN_LIKE.test(value)) return false
  const digits = value.match(/\p{N}/gu)?.length ?? 0
  return digits <= SHARE_LIMITS.digits
}

/** Sender text from a link: accepted only if it is already in canonical, safe form. */
function readShareText(raw: string | null, max: number): string | null {
  if (raw === null) return null
  const text = sanitizeShareText(raw, max)
  if (!text || text !== raw.trim() || countCodePoints(raw.trim()) > max) return null
  return isSafeShareText(text) ? text : null
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** The local calendar date `offset` days from `now`, as YYYY-MM-DD. */
export function localIsoDate(offset = 0, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function readIcon(raw: string | null): string {
  const icon = raw?.trim()
  if (!icon || icon.length > SHARE_LIMITS.icon || !PICTOGRAPHIC.test(icon))
    return DEFAULT_SHARE_ICON
  const segments = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(icon))
  return segments.length === 1 ? icon : DEFAULT_SHARE_ICON
}

function readHour(raw: string | null): number | null {
  const value = raw?.trim()
  if (!value || !HOUR.test(value)) return null
  const hour = Number(value)
  return hour >= 0 && hour <= 24 ? hour : null
}

export function parseActivityShareParams(params: URLSearchParams): ParsedActivityShare | null {
  const activity = readShareText(params.get('a'), SHARE_LIMITS.activity)
  const city = readShareText(params.get('city'), SHARE_LIMITS.place)
  const rawRegion = params.get('region')
  const region = rawRegion?.trim() ? readShareText(rawRegion, SHARE_LIMITS.place) : ''
  const date = params.get('date')?.trim() ?? ''
  const from = readHour(params.get('from'))
  const to = readHour(params.get('to'))

  if (!activity || !city || region === null || !isIsoDate(date)) return null
  if (from === null || to === null || to <= from) return null

  const rawUv = params.get('uv')?.trim()
  const uv = rawUv && UV.test(rawUv) && Number(rawUv) <= 20 ? rawUv : undefined

  return {
    activity,
    icon: readIcon(params.get('icon')),
    city,
    region,
    date,
    from,
    to,
    uv,
  }
}

/** How a shared plan's date relates to the viewer's today. */
export function shareDateStatus(date: string, now = new Date()): 'past' | 'today' | 'future' {
  const today = localIsoDate(0, now)
  return date < today ? 'past' : date === today ? 'today' : 'future'
}

/** "Today", "Tomorrow" or a short weekday date such as "Wed, Jun 17". */
export function formatShareDate(date: string, now = new Date()): string {
  if (date === localIsoDate(0, now)) return 'Today'
  if (date === localIsoDate(1, now)) return 'Tomorrow'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.slice(0, 4) === String(now.getFullYear()) ? undefined : 'numeric',
  })
}

/** The message sent with a share link, with times in the sender's clock format. */
export function buildActivityShareText(
  { activity, window: win, location, dateLabel }: ActivitySharePayload,
  clock: ClockFormat,
): string {
  const time = (hours: number) => formatClockTime(hours, clock)
  const place = `${location.city}${location.region ? `, ${location.region}` : ''}`
  const uvCopy = typeof win.peakUV === 'number' ? ` Peak UV ${formatUV(win.peakUV)}.` : ''
  const duration =
    activity.durationMins < 60 ? `${activity.durationMins} min` : `${activity.durationMins / 60} hr`
  return `Let's do ${activity.name.toLowerCase()} ${dateLabel.toLowerCase()} from ${time(win.from)}–${time(win.to)} in ${place}. Solara estimates this as a lower-UV ${duration} planning window.${uvCopy} Recheck current conditions and use sun protection.`
}

/** Sender text for a link: sanitized, and replaced by `fallback` if it still looks unsafe. */
function shareText(value: string, max: number, fallback: string): string {
  const text = sanitizeShareText(value, max)
  return text && isSafeShareText(text) ? text : fallback
}

export function buildActivityShareUrl(
  { activity, window: win, location, dayOffset = 0, isoDate }: ActivitySharePayload,
  origin?: string,
): string {
  // The build's own site (staging's on staging), never a hard-coded production address.
  const base = origin || SITE_URL
  const params = new URLSearchParams({
    a: shareText(activity.name, SHARE_LIMITS.activity, 'Outdoor activity'),
    icon: readIcon(activity.icon),
    from: String(Math.round(win.from * 100) / 100),
    to: String(Math.round(win.to * 100) / 100),
    city: shareText(location.city, SHARE_LIMITS.place, 'Shared location'),
    date: isoDate && isIsoDate(isoDate) ? isoDate : localIsoDate(dayOffset),
  })
  const region = sanitizeShareText(location.region || '', SHARE_LIMITS.place)
  if (region && isSafeShareText(region)) params.set('region', region)
  if (typeof win.peakUV === 'number') params.set('uv', formatUV(win.peakUV))
  return `${base}/share/?${params.toString()}`
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
