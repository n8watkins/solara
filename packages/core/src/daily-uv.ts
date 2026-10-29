// The daily UV push: a short, free "protect from ... to ..." message for Free accounts,
// while the personalised morning plan (alerts.ts, morningAlertMessage) stays Pro. Pure
// and deterministic, so the scheduled `alerts` Function
// (functions/src/notifications/daily-uv.ts), its tests and a native client agree.
//
// - It goes out once per local day, from the person's morning hour (notificationHour,
//   the same setting as Pro's morning alert), or from the end of their quiet hours when
//   that hour is quiet, and only while sun protection is still needed that day.
// - Only on days the UV index reaches 3 (WHO: "moderate", protection needed), judged under
//   a clear sky like the briefing's advice (protection.ts, which also gives the times); a
//   day that stays low even if the sky clears sends nothing.
// - The job looks at an account only when its next check falls due (`nextDailyUvCheck`),
//   about twice a day, instead of every 15 minutes.
import {
  formatAlertTime,
  inQuietHours,
  morningHour,
  type AlertMessage,
  type QuietHours,
} from './alerts'
import { NOTIFICATION_HOUR } from './prefs'
import { protectionWindow, type ProtectionHour, type ProtectionWindow } from './protection'
import { formatUV, uvLabel } from './uv-scale'
import { instantInZone, isoDateOf, shiftIsoDate, wallClockAt } from './zoned-time'

/** One forecast hour of the day: the UV at that whole local hour, and under a clear sky. */
export type DailyUvHour = ProtectionHour

// The window is shared with the briefing and the alerts (protection.ts).
export { protectionWindow, type ProtectionWindow }

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
 * Once protection is already needed, "Protect until 3:40pm today". The times and the
 * peak line are the briefing's (protection.ts), so the push and the dashboard agree.
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
  const clears = window.cloud ? `, or ${formatUV(window.cloud.clearSky)} if the sky clears` : ''
  const peak = `UV peaks at ${formatUV(window.peak.uv)} (${uvLabel(window.peak.uv)}) around ${time(window.peak.hour)} in ${place}${clears}.`
  const tip = window.forecastReaches
    ? 'Sunscreen, a hat and shade while the UV is moderate or higher.'
    : 'Sunscreen, a hat and shade in case the sky clears.'
  return { title, body: `${peak} ${tip} Recheck current conditions.` }
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
