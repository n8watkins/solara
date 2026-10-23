'use strict'

// iCalendar (RFC 5545) serializer shared by the calendar feed and the browser's
// .ics download (lib/ics.ts loads this module), so both always emit the same
// document. Keep it free of Firebase, browser and Node-only APIs.
// Times are floating local (no TZ): the hour numbers come from Open-Meteo's
// timezone=auto, so they render correctly in the subscriber's local calendar.

const ACTIVITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Activity ids end up in event UIDs, so only plain identifier characters are accepted. */
function validActivityId(id) {
  return typeof id === 'string' && ACTIVITY_ID_PATTERN.test(id)
}

const pad = n => String(n).padStart(2, '0')

/**
 * Escape a TEXT value per RFC 5545: backslash, semicolon, comma and line breaks
 * (CRLF, LF or a lone CR). Other control characters are dropped so a value can
 * never start a new content line.
 */
function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u001f\u007f]/g, '')
}

function localStamp(dateStr, h) {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) {
    hr += 1
    min = 0
  }
  return `${dateStr.replace(/-/g, '')}T${pad(hr)}${pad(min)}00`
}

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function utf8Length(codePoint) {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * RFC 5545 line folding: content lines are at most 75 octets of UTF-8, and each
 * continuation line starts with a single space. Never splits a character.
 */
function fold(line) {
  const out = []
  let current = ''
  let octets = 0
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0))
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

function buildICS(events, now = new Date()) {
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

module.exports = { buildICS, escapeText, validActivityId }
