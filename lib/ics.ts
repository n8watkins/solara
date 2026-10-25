import { windowEventSummary, windowEventUid } from '@solara/core'
import type { SlotRecommendation } from './scheduler'
import type { Activity } from './types'
import { buildEventDescription } from './gcal-view'

// Client-side iCalendar (.ics) export. A static app can't host a live feed without a
// server, but it CAN hand the user a downloadable file that imports into any calendar
// (Google, Apple, Outlook). Times are written as "floating" local wall-clock (no TZ),
// matching the rest of Solara's device-TZ == location-TZ assumption.
// Serialization lives in @solara/core, shared with the calendar feed, so a
// downloaded file and a feed subscription always produce identical documents.
export { buildICS, type IcsEvent } from '@solara/core'
import type { IcsEvent } from '@solara/core'

/** Map a recommended slot to an ICS event, reusing the calendar event description. */
export function recToIcsEvent(
  activity: Activity,
  dateStr: string,
  rec: SlotRecommendation,
): IcsEvent {
  return {
    uid: windowEventUid(dateStr, activity.id, rec.start),
    summary: windowEventSummary(activity),
    description: buildEventDescription(rec, activity, { peakUV: rec.peakUV }),
    dateStr,
    start: rec.start,
    end: rec.end,
  }
}

/** Trigger a browser download of an .ics file. No-op outside the browser. */
export function downloadICS(filename: string, content: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
