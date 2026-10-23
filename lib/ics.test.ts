import { describe, it, expect } from 'vitest'
import type { IcsEvent } from '@/lib/ics'
import { buildICS, recToIcsEvent } from '@/lib/ics'
import type { SlotRecommendation } from '@/lib/scheduler'
import type { Activity } from '@/lib/types'

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

  it('rounds :60 minutes up to the next hour', () => {
    const r = buildICS([{ ...ev, start: 5.999, end: 6.999 }])
    expect(r).toContain('DTSTART:20260530T060000')
    expect(r).toContain('DTEND:20260530T070000')
  })
})

describe('recToIcsEvent', () => {
  const rec: SlotRecommendation = {
    start: 17, end: 18, earliestStart: 17, latestStart: 19,
    windowLabel: 'Evening', peakUV: 3, avgUV: 2, reason: 'Earliest free spot in your evening window',
  }
  const activity: Activity = { id: 'run', name: 'Running', icon: '🏃', durationMins: 60, maxUV: 4, sunscreen: false }

  it('builds a stable uid and reuses the calendar description', () => {
    const e = recToIcsEvent(activity, '2026-05-30', rec)
    expect(e.uid).toBe('2026-05-30-run-1020@solara') // 17 * 60
    expect(e.summary).toContain('Running')
    expect(e.description).toContain('Flexible')
    expect(e.start).toBe(17)
  })
})
