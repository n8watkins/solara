// Plain-JS mirror of the client lib/ics.ts for the Cloud Functions runtime.
// Times are floating local (no TZ) — the feed's hour numbers come from Open-Meteo's
// timezone=auto, so they render correctly in the subscriber's local calendar.

const pad = n => String(n).padStart(2, '0')

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function localStamp(dateStr, h) {
  let hr = Math.floor(h)
  let min = Math.round((h - hr) * 60)
  if (min === 60) { hr += 1; min = 0 }
  return `${dateStr.replace(/-/g, '')}T${pad(hr)}${pad(min)}00`
}

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function fold(line) {
  if (line.length <= 75) return line
  const out = []
  let i = 0
  while (i < line.length) {
    const size = i === 0 ? 75 : 74
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + size))
    i += size
  }
  return out.join('\r\n')
}

function buildICS(events, now = new Date()) {
  const stamp = utcStamp(now)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Solara//Sun Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Solara Sun Plan']
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

module.exports = { buildICS }
