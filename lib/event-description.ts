// A calendar event's description for a scheduled activity: why this slot, how flexible
// it is and the caveat. Its own module, loaded when an event is made (Google Calendar,
// a calendar file), so the first load carries none of it.
import type { SlotRecommendation } from '@solara/core/scheduler'
import m from '@/messages/calendar'
import type { Activity } from './types'
import { fmtClock, formatUV } from './weather'

/** PURE. The human-readable event body explaining the pick and its flexibility. */
export function buildEventDescription(
  rec: SlotRecommendation,
  activity: Activity,
  opts: { peakUV?: number; peakHour?: number } = {},
): string {
  const lines: string[] = [
    m.eventRecommended(
      fmtClock(rec.start),
      `${rec.reason.charAt(0).toLowerCase()}${rec.reason.slice(1)}`,
    ),
  ]
  if (rec.latestStart > rec.earliestStart) {
    lines.push(m.eventFlexible(fmtClock(rec.earliestStart), fmtClock(rec.latestStart)))
  }
  if (typeof opts.peakUV === 'number' && typeof opts.peakHour === 'number') {
    lines.push(m.eventPeak(formatUV(opts.peakUV), fmtClock(opts.peakHour)))
  }
  lines.push(activity.sunscreen ? m.eventSpf : m.eventNoSunscreen)
  lines.push(m.eventCaveat)
  lines.push(m.eventPlannedBy)
  return lines.join('\n')
}
