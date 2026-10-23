// iCalendar (RFC 5545) serializer shared by the calendar feed and the browser's
// .ics download, so both always emit the same document. Keep it free of
// Firebase, browser and Node-only APIs.
// Times are floating local (no TZ): the hour numbers come from Open-Meteo's
// timezone=auto, so they render correctly in the subscriber's local calendar.

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  /** Local date, YYYY-MM-DD. */
  dateStr: string
  /** Fractional local hour. */
  start: number
  end: number
}

const ACTIVITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Activity ids end up in event UIDs, so only plain identifier characters are accepted. */
export function validActivityId(id: unknown): id is string {
  return typeof id === 'string' && ACTIVITY_ID_PATTERN.test(id)
}

/** Stable event UID for an activity's window starting at `start` (fractional hour) on a date. */
export function windowEventUid(dateStr: string, activityId: string, start: number): string {
  return `${dateStr}-${activityId}-${Math.round(start * 60)}@solara`
}

/** Calendar event title for an activity's lower-UV window. */
export function windowEventTitle(activityName: string): string {
  return `${activityName}: lower-UV window`
}

/** Calendar event summary: the title led by the activity's icon. */
export function windowEventSummary(activity: { icon?: string | null; name: string }): string {
  return `${activity.icon || '☀️'} ${windowEventTitle(activity.name)}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Escape a TEXT value per RFC 5545: backslash, semicolon, comma and line breaks
 * (CRLF, LF or a lone CR). Other control characters are dropped so a value can
 * never start a new content line.
 */
export function escapeText(s: unknown): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u001f\u007f]/g, '')
}

function localStamp(dateStr: string, h: number): string {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) {
    hr += 1
    min = 0
  }
  return `${dateStr.replace(/-/g, '')}T${pad(hr)}${pad(min)}00`
}

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * RFC 5545 line folding: content lines are at most 75 octets of UTF-8, and each
 * continuation line starts with a single space. Never splits a character.
 */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let octets = 0
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0) ?? 0)
    const limit = out.length === 0 ? 75 : 74
    if (octets + size > limit) {
      out.push(out.length === 0 ? current : ` ${current}`)
      current = ''
      octets = 0
    }
    current += char
    octets += size
  }
  out.push(out.length === 0 ? current : ` ${current}`)
  return out.join('\r\n')
}

/** Serialize events into a VCALENDAR document (CRLF-delimited, RFC 5545). */
export function buildICS(events: readonly IcsEvent[], now: Date = new Date()): string {
  const stamp = utcStamp(now)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Solara//Sun Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Solara Sun Plan',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
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
