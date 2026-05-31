import { SlotRecommendation } from './scheduler'
import { Activity } from './types'
import { buildEventDescription } from './gcal'

// Client-side iCalendar (.ics) export. A static app can't host a live feed without a
// server, but it CAN hand the user a downloadable file that imports into any calendar
// (Google, Apple, Outlook). Times are written as "floating" local wall-clock (no TZ),
// matching the rest of Solara's device-TZ == location-TZ assumption.

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  dateStr: string   // YYYY-MM-DD
  start: number     // fractional hour, local
  end: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Escape per RFC5545: backslash, semicolon, comma, and newlines. */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Floating local timestamp "YYYYMMDDTHHMMSS" (no Z, no TZID). */
function localStamp(dateStr: string, h: number): string {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) { hr += 1; min = 0 }
  return `${dateStr.replace(/-/g, '')}T${pad(hr)}${pad(min)}00`
}

/** UTC timestamp with Z, for DTSTAMP. */
function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** RFC5545 line folding: continuation lines start with a single space, max 75 octets. */
function fold(line: string): string {
  if (line.length <= 75) return line
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + (i === 0 ? 75 : 74)))
    i += i === 0 ? 75 : 74
  }
  return out.join('\r\n')
}

/** PURE. Serialize events into a valid VCALENDAR document (CRLF-delimited). */
export function buildICS(events: IcsEvent[], now: Date = new Date()): string {
  const stamp = utcStamp(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Solara//Sun Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localStamp(e.dateStr, e.start)}`,
      `DTEND:${localStamp(e.dateStr, e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n')
}

/** Map a recommended slot to an ICS event, reusing the calendar event description. */
export function recToIcsEvent(activity: Activity, dateStr: string, rec: SlotRecommendation): IcsEvent {
  return {
    uid: `${dateStr}-${activity.id}-${Math.round(rec.start * 60)}@solara`,
    summary: `${activity.icon} ${activity.name} — sun window`,
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
