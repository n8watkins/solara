import { describe, it, expect } from 'vitest'
import type { IcsEvent } from '@/lib/ics'
import { buildICS, recToIcsEvent } from '@/lib/ics'
import type { SlotRecommendation } from '@/lib/scheduler'
import type { Activity } from '@/lib/types'

/* eslint-disable @typescript-eslint/no-require-imports */
const feedIcs = require('../functions/core')
const sun = require('../functions/lib/sun')
/* eslint-enable @typescript-eslint/no-require-imports */

const ev: IcsEvent = {
  uid: 'u1@solara',
  summary: 'Run',
  description: 'line one\nline two',
  dateStr: '2026-05-30',
  start: 17.5,
  end: 18.5,
}

describe('buildICS', () => {
  const out = buildICS([ev], new Date('2026-05-30T12:00:00Z'))

  it('wraps events in a valid VCALENDAR', () => {
    expect(out.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(out.trim().endsWith('END:VCALENDAR')).toBe(true)
    expect(out).toContain('VERSION:2.0')
    expect(out).toContain('BEGIN:VEVENT')
    expect(out).toContain('END:VEVENT')
    expect(out).toContain('\r\n') // CRLF delimited
  })

  it('writes floating local DTSTART/DTEND (no Z) from fractional hours', () => {
    expect(out).toContain('DTSTART:20260530T173000')
    expect(out).toContain('DTEND:20260530T183000')
  })

  it('writes a UTC DTSTAMP', () => {
    expect(out).toContain('DTSTAMP:20260530T120000Z')
  })

  it('escapes newlines in text fields', () => {
    expect(out).toContain('DESCRIPTION:line one\\nline two')
  })

  it('escapes commas and semicolons', () => {
    const r = buildICS([{ ...ev, summary: 'Hike, then nap; relax' }])
    expect(r).toContain('SUMMARY:Hike\\, then nap\\; relax')
  })

  it('escapes the UID so an id cannot inject properties', () => {
    const r = buildICS([{ ...ev, uid: 'x\r\nATTENDEE:mailto:evil@example.com;y,z' }])
    expect(r).toContain('UID:x\\nATTENDEE:mailto:evil@example.com\\;y\\,z')
    expect(r.split('\r\n').some(line => line.startsWith('ATTENDEE'))).toBe(false)
  })

  it('treats a lone CR as a line break and drops other control characters', () => {
    const r = buildICS([{ ...ev, summary: 'a\rb\u0007c\u0000' }])
    expect(r).toContain('SUMMARY:a\\nbc\r\n')
  })

  it('folds lines at 75 octets without splitting a character', () => {
    const r = buildICS([{ ...ev, summary: '🏃'.repeat(40) }])
    const lines = r.split('\r\n')
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    }
    const unfolded = r.replace(/\r\n /g, '')
    expect(unfolded).toContain(`SUMMARY:${'🏃'.repeat(40)}\r\n`)
  })

  it('emits the same document as the calendar feed', () => {
    const events = [ev, { ...ev, uid: 'u2@solara', summary: '🏃 Running: lower-UV window' }]
    const now = new Date('2026-05-30T12:00:00Z')
    expect(buildICS(events, now)).toBe(feedIcs.buildICS(events, now))
  })

  it('rounds :60 minutes up to the next hour', () => {
    const r = buildICS([{ ...ev, start: 5.999, end: 6.999 }])
    expect(r).toContain('DTSTART:20260530T060000')
    expect(r).toContain('DTEND:20260530T070000')
  })
})

describe('recToIcsEvent', () => {
  const rec: SlotRecommendation = {
    start: 17,
    end: 18,
    earliestStart: 17,
    latestStart: 19,
    windowLabel: 'Evening',
    peakUV: 3,
    avgUV: 2,
    reason: 'Earliest free spot in your evening window',
  }
  const activity: Activity = {
    id: 'run',
    name: 'Running',
    icon: '🏃',
    durationMins: 60,
    maxUV: 4,
    sunscreen: false,
  }

  it('builds a stable uid and reuses the calendar description', () => {
    const e = recToIcsEvent(activity, '2026-05-30', rec)
    expect(e.uid).toBe('2026-05-30-run-1020@solara') // 17 * 60
    expect(e.summary).toBe('🏃 Running: lower-UV window')
    expect(e.description).toContain('Flexible')
    expect(e.start).toBe(17)
  })
})

describe('calendar feed events', () => {
  const day = { dateStr: '2026-05-30', hourly: [6, 7, 8].map(hour => ({ hour, uv: 1 })) }
  const base = { name: 'Walk', icon: '🚶', durationMins: 60, maxUV: 3, sunscreen: false }

  it('uses the same summary wording as the downloaded file', () => {
    const [event] = sun.buildSunEvents({ activities: [{ ...base, id: 'walk' }] }, [day])
    expect(event.summary).toBe('🚶 Walk: lower-UV window')
  })

  it('skips activities whose id is not a plain identifier', () => {
    const activities = [
      { ...base, id: 'custom_1717000000000' },
      { ...base, id: 'bad\r\nATTENDEE:x' },
      { ...base, id: '' },
      { ...base, id: 42 },
      { ...base, id: 'x'.repeat(65) },
    ]
    const events = sun.buildSunEvents({ activities }, [day])
    expect(events.map((e: { uid: string }) => e.uid)).toEqual([
      '2026-05-30-custom_1717000000000-360@solara',
    ])
  })

  it('validates activity ids', () => {
    expect(feedIcs.validActivityId('run')).toBe(true)
    expect(feedIcs.validActivityId('custom_123-a')).toBe(true)
    expect(feedIcs.validActivityId('a b')).toBe(false)
    expect(feedIcs.validActivityId(undefined)).toBe(false)
  })
})
