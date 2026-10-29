// The daily UV push: a short, free "protect from ... to ..." message for Free accounts,
// while the personalised morning plan (alerts.ts, morningAlertMessage) stays Pro. Pure
// and deterministic, so the scheduled `alerts` Function
// (functions/src/notifications/daily-uv.ts), its tests and a native client agree.
//
// - It goes out once per local day, from the person's morning hour (notificationHour,
//   the same setting as Pro's morning alert), or from the end of their quiet hours when
//   that hour is quiet, and only while sun protection is still needed that day.
// - Only on days the UV index reaches 3 (WHO: "moderate", protection needed); a low day
//   sends nothing.
// - The job looks at an account only when its next check falls due (`nextDailyUvCheck`),
//   about twice a day, instead of every 15 minutes.
import {
  formatAlertTime,
  inQuietHours,
  morningHour,
  type AlertMessage,
  type QuietHours,
} from './alerts'
import { PROTECT_FROM_UV } from './briefing'
import { NOTIFICATION_HOUR } from './prefs'
import type { Daylight } from './sun-times'
import { formatUV, uvLabel } from './uv-scale'
import { instantInZone, isoDateOf, shiftIsoDate, wallClockAt } from './zoned-time'

/** One forecast hour of the day: the UV at that whole local hour. */
export interface DailyUvHour {
  hour: number
  uv: number
}

/** When sun protection is needed today, and the day's peak. */
export interface ProtectionWindow {
  /** Fractional local hour the UV index first reaches 3, on a 5-minute step. */
  from: number
  /** Fractional local hour it last drops below 3, on a 5-minute step. */
  to: number
  peak: { uv: number; hour: number }
}

/**
 * The forecast UV at which the index reads 3 (the scale rounds, so 2.5 already shows as
 * 3, as the dashboard's bands and the UV alert read it).
 */
const PROTECT_AT = PROTECT_FROM_UV - 0.5

const STEP = 1 / 12

/** Rounds a fractional hour down (or up) to a 5-minute step. */
function toStep(hours: number, direction: 'down' | 'up'): number {
  const steps = hours / STEP
  // A tiny tolerance so 10.0000001 stays 10:00 instead of 10:05.
  const rounded = direction === 'down' ? Math.floor(steps + 1e-6) : Math.ceil(steps - 1e-6)
  return rounded * STEP
}

/**
 * When the UV is at least moderate today: from the first moment the forecast reaches it
 * to the last moment it is above it, read between the hourly values (each hour's value
 * is the UV at the start of that hour), earlier at the start and later at the end, so
 * the window errs on the side of protection. One window for the whole day, even if a
 * cloudy hour dips below in the middle. Null when the UV stays low all day.
 */
export function protectionWindow(
  hourly: readonly DailyUvHour[],
  daylight?: Daylight | null,
): ProtectionWindow | null {
  const hours = hourly
    .filter(h => Number.isFinite(h.uv) && Number.isFinite(h.hour))
    .slice()
    .sort((a, b) => a.hour - b.hour)
  const firstIndex = hours.findIndex(h => h.uv >= PROTECT_AT)
  if (firstIndex < 0) return null
  let lastIndex = firstIndex
  hours.forEach((h, index) => {
    if (h.uv >= PROTECT_AT) lastIndex = index
  })
  const first = hours[firstIndex] as DailyUvHour
  const last = hours[lastIndex] as DailyUvHour

  const before = hours[firstIndex - 1]
  const from =
    before && before.hour === first.hour - 1 && before.uv < PROTECT_AT
      ? before.hour + (PROTECT_AT - before.uv) / (first.uv - before.uv)
      : first.hour
  const after = hours[lastIndex + 1]
  const to =
    after && after.hour === last.hour + 1 && after.uv < PROTECT_AT
      ? last.hour + (last.uv - PROTECT_AT) / (last.uv - after.uv)
      : last.hour + 1

  const peak = hours
    .slice(firstIndex, lastIndex + 1)
    .reduce((max, h) => (h.uv > max.uv ? h : max), first)
  let start = toStep(from, 'down')
  // A peak that only touches 3 still gets one 5-minute step.
  let end = Math.max(toStep(to, 'up'), start + STEP)
  if (daylight) {
    start = Math.max(start, daylight.from)
    end = Math.min(end, daylight.to)
  }
  if (end <= start) return null
  return { from: start, to: end, peak: { uv: peak.uv, hour: peak.hour } }
}

/**
 * The local hour the daily UV push may go out from: the morning hour, or the first hour
 * after it outside quiet hours (a morning hour of 6 with quiet hours until 8 sends at 8).
 */
export function dailyUvSendHour(notificationHour: unknown, quiet: QuietHours): number {
  const start = morningHour(notificationHour)
  for (let hour = start; hour < 24; hour++) {
    if (!inQuietHours(hour, quiet)) return hour
  }
  // Quiet all day from the morning hour: wait for the end of the quiet hours anyway.
  return quiet.to > start ? quiet.to : start
}

/**
 * Whether the push is due at this local hour: from its send hour, while protection is
 * still needed (before the window ends), outside quiet hours.
 */
export function dailyUvDue(
  localHour: number,
  sendHour: number,
  window: ProtectionWindow,
  quiet: QuietHours,
): boolean {
  return localHour >= sendHour && localHour < window.to && !inQuietHours(localHour, quiet)
}

export interface DailyUvMessageInput {
  window: ProtectionWindow
  city: string
  /** The local hour the push goes out. */
  localHour: number
  clock?: '12h' | '24h'
}

/**
 * "☀️ Protect from 10:10am to 3:40pm today", with the peak and a short tip in the body.
 * Once protection is already needed, "Protect until 3:40pm today".
 */
export function dailyUvMessage({
  window,
  city,
  localHour,
  clock,
}: DailyUvMessageInput): AlertMessage {
  const time = (hours: number) => formatAlertTime(hours, clock)
  const place = city.trim() || 'your area'
  const title =
    localHour < window.from
      ? `☀️ Protect from ${time(window.from)} to ${time(window.to)} today`
      : `☀️ Protect until ${time(window.to)} today`
  const peak = `UV peaks at ${formatUV(window.peak.uv)} (${uvLabel(window.peak.uv).toLowerCase()}) around ${time(window.peak.hour)} in ${place}.`
  return {
    title,
    body: `${peak} Sunscreen, a hat and shade while the UV is moderate or higher. Recheck current conditions.`,
  }
}

/**
 * When the job should next look at an account (epoch ms): today at the send hour while
 * that is still ahead and today's push has not gone out, else tomorrow at the earliest
 * morning hour (NOTIFICATION_HOUR.min), so a morning hour changed overnight is read
 * before it falls due. That is at most two looks a day.
 */
export function nextDailyUvCheck({
  nowMs,
  timeZone,
  sendHour,
  doneToday,
}: {
  nowMs: number
  timeZone: string
  sendHour: number
  /** Whether today needs nothing more (sent, a low day, or past its window). */
  doneToday: boolean
}): number {
  const local = wallClockAt(nowMs, timeZone)
  const hour = local.hour + local.minute / 60
  const today = { year: local.year, month: local.month, day: local.day }
  if (!doneToday && hour < sendHour) {
    return instantInZone({ ...today, hour: sendHour, minute: 0, second: 0 }, timeZone)
  }
  const [year, month, day] = shiftIsoDate(isoDateOf(today), 1).split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const wake = Math.min(NOTIFICATION_HOUR.min, sendHour)
  const next = instantInZone({ year, month, day, hour: wake, minute: 0, second: 0 }, timeZone)
  // Never in the past or right now (a zone with no such hour that day, say).
  return next > nowMs ? next : nowMs + 60 * 60_000
}
