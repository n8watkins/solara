// Pro alerts: when each one is due and what it says. Pure and deterministic, so the
// scheduled `alerts` Function (functions/src/notifications/alerts.ts), its tests and
// any future client (the mobile app) agree on every decision.
//
// - The morning alert goes out once per local day, in the two hours from the hour the
//   person picked (notificationHour, 5-10). Quiet hours do not apply to it: its hour
//   is the person's own choice.
// - The UV alert goes out at most once per local day, when today's forecast UV index
//   reaches the person's threshold: from an hour before the first such hour until the
//   last one ends, outside quiet hours.
import {
  bestWindow,
  burnMins,
  effectiveMaxUV,
  isSkinType,
  runsOn,
  type PreferredHours,
  type SkinType,
} from './recommendation'
import { NOTIFICATION_HOUR, QUIET_HOURS, UV_ALERT_THRESHOLD } from './prefs'

/** The kinds of alert, each sent at most once per local day. */
export const ALERT_KINDS = Object.freeze(['morning', 'uv'] as const)
export type AlertKind = (typeof ALERT_KINDS)[number]

/** How long after the chosen hour a morning alert may still go out. */
export const MORNING_ALERT_WINDOW_HOURS = 2
/** How long before the UV first reaches the threshold the UV alert may go out. */
export const UV_ALERT_LEAD_HOURS = 1

/** A moment in a place's own time zone: its date and fractional hour (7.5 is 7:30). */
export interface LocalTime {
  date: string
  hour: number
}

/** The local date and time of `now` in an IANA time zone, or null for an unknown zone. */
export function localTime(now: Date, timeZone: string): LocalTime | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find(item => item.type === type)?.value ?? ''
    const hour = Number(part('hour'))
    const minute = Number(part('minute'))
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: hour + minute / 60 }
  } catch {
    return null
  }
}

/** The morning hour a stored value stands for: a whole hour from 5 to 10, default 7. */
export function morningHour(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(NOTIFICATION_HOUR.max, Math.max(NOTIFICATION_HOUR.min, Math.round(value)))
    : NOTIFICATION_HOUR.default
}

/** Whether the morning alert is due at this local hour. */
export function morningAlertDue(localHour: number, notificationHour: unknown): boolean {
  const from = morningHour(notificationHour)
  return localHour >= from && localHour < from + MORNING_ALERT_WINDOW_HOURS
}

/** The UV alert threshold a stored value stands for, or null when the alert is off. */
export function uvAlertThreshold(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(UV_ALERT_THRESHOLD.max, Math.max(UV_ALERT_THRESHOLD.min, Math.round(value)))
}

export interface QuietHours {
  from: number
  to: number
}

/** The quiet hours a stored value stands for: valid whole hours, or the default. */
export function quietHours(value: unknown): QuietHours {
  const raw = value as { from?: unknown; to?: unknown } | null | undefined
  const hour = (input: unknown) =>
    typeof input === 'number' && Number.isInteger(input) && input >= 0 && input <= 23 ? input : null
  const from = hour(raw?.from)
  const to = hour(raw?.to)
  return from === null || to === null ? { ...QUIET_HOURS.default } : { from, to }
}

/** Whether a fractional local hour falls in quiet hours ([from, to), across midnight if needed). */
export function inQuietHours(localHour: number, quiet: QuietHours): boolean {
  if (quiet.from === quiet.to) return false
  return quiet.from < quiet.to
    ? localHour >= quiet.from && localHour < quiet.to
    : localHour >= quiet.from || localHour < quiet.to
}

/** One forecast hour of the alert's day, in local time. */
export interface AlertHour {
  hour: number
  uv: number
}

/** When today's UV is at or above a threshold. */
export interface UvAlertPlan {
  threshold: number
  /** The first hour whose UV index reaches the threshold. */
  from: number
  /** The end of the last such hour. */
  to: number
  peak: { uv: number; hour: number }
}

/**
 * The UV index as the scale reads it: whole numbers, so 5.6 already counts as 6. The
 * dashboard's bands and the daily briefing read it the same way.
 */
function uvIndex(uv: number): number {
  return Math.round(uv)
}

/** When the UV index reaches `threshold` today, or null when it stays below all day. */
export function planUvAlert(hourly: readonly AlertHour[], threshold: number): UvAlertPlan | null {
  const above = hourly.filter(h => Number.isFinite(h.uv) && uvIndex(h.uv) >= threshold)
  const first = above[0]
  const last = above.at(-1)
  if (!first || !last) return null
  const peak = above.reduce((max, h) => (h.uv > max.uv ? h : max), first)
  return { threshold, from: first.hour, to: last.hour + 1, peak: { uv: peak.uv, hour: peak.hour } }
}

/** Whether the UV alert is due at this local hour. */
export function uvAlertDue(plan: UvAlertPlan, localHour: number, quiet: QuietHours): boolean {
  return (
    localHour >= plan.from - UV_ALERT_LEAD_HOURS &&
    localHour < plan.to &&
    !inQuietHours(localHour, quiet)
  )
}

export interface AlertMessage {
  title: string
  body: string
}

/** "6am", "6:30am", "12pm", or "06:30" on a 24-hour clock. */
export function formatAlertTime(hours: number, clock: '12h' | '24h' = '12h'): string {
  const total = Math.round(hours * 60)
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  if (clock === '24h') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const suffix = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${suffix}`
}

/** The parts of an activity the morning alert plans with. */
export interface AlertActivity {
  name: string
  icon?: string | null
  maxUV?: number | null
  sunscreen?: boolean | null
  durationMins?: number | null
  preferredHours?: PreferredHours | null
  daysOfWeek?: readonly number[] | null
}

export interface MorningAlertInput {
  /** The local date the alert covers. */
  date: string
  city: string
  /** That day's daytime hours with a known UV, in order. */
  hourly: readonly AlertHour[]
  activities: readonly AlertActivity[]
  skinType: unknown
  clock?: '12h' | '24h'
}

const oneDecimal = (uv: number) => String(Math.round(uv * 10) / 10)

/**
 * The morning alert: the first of the day's activities with a lower-UV window, the
 * day's peak and the burn estimate at it.
 *
 * The body is written to be replaced by the daily briefing's text (`dailyBriefing`,
 * built in the FEAT2 lane) once that lands in this package, so the dashboard card, a
 * share and this push say the same; the inputs here are the briefing's inputs.
 */
export function morningAlertMessage(input: MorningAlertInput): AlertMessage {
  const time = (hours: number) => formatAlertTime(hours, input.clock)
  const skinType: SkinType = isSkinType(input.skinType) ? input.skinType : 'fair'
  const city = input.city.trim() || 'your area'
  const peak = input.hourly.reduce<AlertHour | null>(
    (max, h) => (max === null || h.uv > max.uv ? h : max),
    null,
  )
  const peakText = peak
    ? `Peak UV ${oneDecimal(peak.uv)} around ${time(peak.hour)} in ${city}.`
    : `No UV forecast for ${city} yet.`
  const burn = peak ? burnMins(peak.uv, skinType) : null
  const burnText = burn ? ` About ${burn} min to a burn at the peak, as an estimate.` : ''

  for (const activity of input.activities) {
    if (!runsOn(activity, input.date)) continue
    const limit = effectiveMaxUV(activity)
    const window = bestWindow(
      input.hourly,
      limit,
      activity.durationMins ?? 30,
      activity.preferredHours,
    )
    if (!window) continue
    return {
      title: `${activity.icon || '☀️'} ${activity.name}: ${time(window.from)} to ${time(window.to)}`,
      body:
        `Estimated lower-UV window: UV at or below ${limit}` +
        `${activity.sunscreen ? ' with SPF 30+' : ''}. ${peakText}${burnText}` +
        ' Recheck current conditions.',
    }
  }

  return {
    title: `☀️ UV today in ${city}`,
    body:
      `${peakText} No lower-UV window fits your activities today.${burnText}` +
      ' Recheck current conditions.',
  }
}

export interface UvAlertInput {
  plan: UvAlertPlan
  city: string
  /** The local hour the alert goes out. */
  localHour: number
  clock?: '12h' | '24h'
}

/** The UV alert: when the UV reaches the threshold, until when, and the peak. */
export function uvAlertMessage({ plan, city, localHour, clock }: UvAlertInput): AlertMessage {
  const time = (hours: number) => formatAlertTime(hours, clock)
  const place = city.trim() || 'your area'
  const until = `until about ${time(plan.to)}, peaking at ${oneDecimal(plan.peak.uv)} around ${time(plan.peak.hour)}`
  const title =
    localHour < plan.from
      ? `☀️ UV reaches ${plan.threshold} around ${time(plan.from)}`
      : `☀️ UV is ${plan.threshold} or higher now`
  return {
    title,
    body: `Forecast for ${place}: UV ${plan.threshold}+ ${until}. Plan shade and sun protection, and recheck current conditions.`,
  }
}
