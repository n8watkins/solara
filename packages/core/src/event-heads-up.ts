// The Pro heads-up before an event with high UV (docs/integrations/EVENTS.md, phase 2):
// a push a few hours before an imported or linked event whose peak UV is high, sent by
// the scheduled `alerts` Function (functions/src/notifications/alerts.ts) with the
// morning and UV alerts' devices, quiet hours and at-most-once delivery.
//
// Pure, so the timing and the words are unit tested here.

import {
  type AlertMessage,
  type QuietHours,
  formatAlertTime,
  inQuietHours,
  localTime,
} from './alerts'
import { formatUV } from './uv-scale'

/** Defaults, owner may change (docs/ROADMAP.md decisions, 2026-10-28). */
export const EVENT_HEADS_UP = Object.freeze({
  /** A heads-up goes out for an event whose peak UV index reaches this (WHO "high"). */
  uv: 6,
  /** It goes out this long before the start... */
  leadHours: 3,
  /** ...and never later than this before the start. */
  latestMinutes: 15,
  /** When the lead time falls in quiet hours, it may move this far earlier (the evening before). */
  maxShiftHours: 16,
  /** Events starting within this many hours are looked at in each run. */
  lookaheadHours: 20,
})

/**
 * When the heads-up for an event may go out, as epoch ms: `leadHours` before the start,
 * or, when that falls in the person's quiet hours, the last whole hour before the quiet
 * hours began (the evening before an early start). `timeZone` is the person's own.
 */
export function eventHeadsUpFrom(startMs: number, timeZone: string, quiet: QuietHours): number {
  const target = startMs - EVENT_HEADS_UP.leadHours * 3_600_000
  const at = (ms: number) => localTime(new Date(ms), timeZone)
  const local = at(target)
  if (!local || !inQuietHours(local.hour, quiet)) return target
  // Step back to the end of the last hour before quiet hours started.
  const intoHour = (local.hour % 1) * 3_600_000
  let probe = target - intoHour
  for (let step = 0; step < EVENT_HEADS_UP.maxShiftHours; step += 1) {
    const previous = probe - 3_600_000
    const hour = at(previous)
    if (hour && !inQuietHours(hour.hour, quiet)) return previous
    probe = previous
  }
  return target
}

/**
 * Whether an event's heads-up is due now: from `eventHeadsUpFrom` until `latestMinutes`
 * before the start, outside quiet hours.
 */
export function eventHeadsUpDue({
  startMs,
  nowMs,
  timeZone,
  quiet,
}: {
  startMs: number
  nowMs: number
  /** The person's own time zone (their quiet hours are in it). */
  timeZone: string
  quiet: QuietHours
}): boolean {
  if (nowMs >= startMs - EVENT_HEADS_UP.latestMinutes * 60_000) return false
  if (nowMs < eventHeadsUpFrom(startMs, timeZone, quiet)) return false
  const local = localTime(new Date(nowMs), timeZone)
  return !!local && !inQuietHours(local.hour, quiet)
}

/** Whether a peak UV is high enough for a heads-up (the UV index reads whole numbers). */
export function eventHeadsUpWorthy(peakUV: number): boolean {
  return Number.isFinite(peakUV) && Math.round(peakUV) >= EVENT_HEADS_UP.uv
}

export interface EventHeadsUpInput {
  title: string
  /** Where the UV is forecast ("Balboa Park" or "San Diego, California"). */
  placeLabel: string
  startMs: number
  /** The event place's zone, for the times in the message. */
  timeZone: string
  peakUV: number
  peakAtMs: number
  nowMs: number
  clock?: '12h' | '24h'
}

/** "🗓️ Saturday 10K at 8am: UV up to 7.2" with sunscreen timing in the body. */
export function eventHeadsUpMessage({
  title,
  placeLabel,
  startMs,
  timeZone,
  peakUV,
  peakAtMs,
  nowMs,
  clock,
}: EventHeadsUpInput): AlertMessage {
  const local = (ms: number) => localTime(new Date(ms), timeZone)
  const time = (ms: number) => {
    const at = local(ms)
    return at ? formatAlertTime(at.hour, clock) : ''
  }
  const startDay = local(startMs)?.date
  const today = local(nowMs)?.date
  const at = time(startMs)
  const when = !at
    ? 'soon'
    : startDay && today && startDay !== today
      ? `tomorrow at ${at}`
      : `at ${at}`
  const name = title.trim() || 'Your event'
  const place = placeLabel.trim()
  return {
    title: `🗓️ ${name} ${when}: UV up to ${formatUV(peakUV)}`,
    body:
      `${place ? `Forecast for ${place}: ` : ''}UV peaks at ${formatUV(peakUV)} around ${time(peakAtMs)}. ` +
      `Apply sunscreen 15 to 30 minutes before you go, reapply every 2 hours, and plan for shade.`,
  }
}
