// The Google Calendar parts the dashboard draws with: whether the integration is
// configured, busy periods as hours of a day, and the description of a scheduled
// event. The Google Identity Services and Calendar API code in lib/gcal.ts loads only
// when someone connects or schedules; it re-exports these.
import type { BusyInterval, SlotRecommendation } from './scheduler'
import type { Activity } from './types'
import { fmtClock, formatUV } from './weather'
import { addDays, isIsoDate, zonedInstant } from './time'

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID

/** Whether this build has a Google OAuth client, so calendar features show at all. */
export function isCalendarConfigured(): boolean {
  return !!CLIENT_ID
}

/** A busy block from the freeBusy API, as RFC3339 timestamps. */
export interface BusyPeriod {
  start: string
  end: string
}

/**
 * PURE. Convert absolute busy periods into per-day busy intervals in fractional
 * hours since local midnight of `dateStr` (YYYY-MM-DD) in the forecast location's
 * `timeZone`, clipped to the day. Handles multi-day and midnight-spanning events
 * and 23- or 25-hour DST days; drops periods that miss the day. The engine's
 * subtractBusy sorts and merges, so no need to here.
 */
export function busyIntervalsForDay(
  periods: BusyPeriod[],
  dateStr: string,
  timeZone: string,
): BusyInterval[] {
  if (!isIsoDate(dateStr)) return []
  const dayStart = zonedInstant(dateStr, 0, timeZone)
  const dayEnd = zonedInstant(addDays(dateStr, 1), 0, timeZone)
  if (Number.isNaN(dayStart) || Number.isNaN(dayEnd)) return []

  const out: BusyInterval[] = []
  for (const p of periods) {
    const s = new Date(p.start).getTime()
    const e = new Date(p.end).getTime()
    if (Number.isNaN(s) || Number.isNaN(e)) continue
    const overlapStart = Math.max(s, dayStart)
    const overlapEnd = Math.min(e, dayEnd)
    if (overlapEnd <= overlapStart) continue
    out.push({
      start: (overlapStart - dayStart) / 3_600_000,
      end: (overlapEnd - dayStart) / 3_600_000,
    })
  }
  return out
}

/** PURE. The human-readable event body explaining the pick and its flexibility. */
export function buildEventDescription(
  rec: SlotRecommendation,
  activity: Activity,
  opts: { peakUV?: number; peakHour?: number } = {},
): string {
  const lines: string[] = [
    `Recommended for ${fmtClock(rec.start)}: ${rec.reason.charAt(0).toLowerCase()}${rec.reason.slice(1)}.`,
  ]
  if (rec.latestStart > rec.earliestStart) {
    lines.push(
      `Flexible: start anytime ${fmtClock(rec.earliestStart)}–${fmtClock(rec.latestStart)} within the estimated lower-UV window.`,
    )
  }
  if (typeof opts.peakUV === 'number' && typeof opts.peakHour === 'number') {
    lines.push(`Peak UV ${formatUV(opts.peakUV)} around ${fmtClock(opts.peakHour)}.`)
  }
  lines.push(activity.sunscreen ? 'Assumes SPF 30+.' : 'Planned for no sunscreen.')
  lines.push('Forecast-based estimate only. Recheck current UV and use sun protection.')
  lines.push('Planned by Solara ☀️')
  return lines.join('\n')
}
