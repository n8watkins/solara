import type { SlotRecommendation } from './scheduler'
import type { Activity } from './types'
import { buildEventDescription } from './gcal'

// Client-side iCalendar (.ics) export. A static app can't host a live feed without a
// server, but it CAN hand the user a downloadable file that imports into any calendar
// (Google, Apple, Outlook). Times are written as "floating" local wall-clock (no TZ),
// matching the rest of Solara's device-TZ == location-TZ assumption.
// Serialization lives in functions/lib/ics.js, shared with the calendar feed.

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  dateStr: string // YYYY-MM-DD
  start: number // fractional hour, local
  end: number
}

type IcsCore = {
  buildICS: (events: IcsEvent[], now?: Date) => string
}

// The same serializer the calendar feed uses, so a downloaded file and a feed
// subscription always produce identical documents.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../functions/lib/ics') as IcsCore

/** PURE. Serialize events into a valid VCALENDAR document (CRLF-delimited, RFC 5545). */
export function buildICS(events: IcsEvent[], now: Date = new Date()): string {
  return core.buildICS(events, now)
}

/** Map a recommended slot to an ICS event, reusing the calendar event description. */
export function recToIcsEvent(
  activity: Activity,
  dateStr: string,
  rec: SlotRecommendation,
): IcsEvent {
  return {
    uid: `${dateStr}-${activity.id}-${Math.round(rec.start * 60)}@solara`,
    summary: `${activity.icon} ${activity.name}: lower-UV window`,
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
