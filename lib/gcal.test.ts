import { describe, it, expect } from 'vitest'
import { busyIntervalsForDay, BusyPeriod, buildEventBody, buildEventDescription } from '@/lib/gcal'
import { SlotRecommendation } from '@/lib/scheduler'
import { Activity } from '@/lib/types'

// Timestamps use no 'Z' so they parse in node's local TZ — the same offset as the
// day anchor, so the fractional-hour math is deterministic regardless of machine TZ.
const D = '2026-05-29'

describe('busyIntervalsForDay', () => {
  it('maps an event inside the day to fractional hours', () => {
    const periods: BusyPeriod[] = [{ start: `${D}T09:30:00`, end: `${D}T10:15:00` }]
    expect(busyIntervalsForDay(periods, D)).toEqual([{ start: 9.5, end: 10.25 }])
  })

  it('clips an event that starts the previous day', () => {
    const periods: BusyPeriod[] = [{ start: '2026-05-28T23:00:00', end: `${D}T01:30:00` }]
    expect(busyIntervalsForDay(periods, D)).toEqual([{ start: 0, end: 1.5 }])
  })

  it('clips an event that runs past midnight', () => {
    const periods: BusyPeriod[] = [{ start: `${D}T23:00:00`, end: '2026-05-30T02:00:00' }]
    expect(busyIntervalsForDay(periods, D)).toEqual([{ start: 23, end: 24 }])
  })

  it('treats a multi-day event as busy all day', () => {
    const periods: BusyPeriod[] = [{ start: '2026-05-27T00:00:00', end: '2026-05-31T00:00:00' }]
    expect(busyIntervalsForDay(periods, D)).toEqual([{ start: 0, end: 24 }])
  })

  it('drops events on other days', () => {
    const periods: BusyPeriod[] = [{ start: '2026-05-30T09:00:00', end: '2026-05-30T10:00:00' }]
    expect(busyIntervalsForDay(periods, D)).toEqual([])
  })

  it('keeps multiple same-day events (engine sorts/merges later)', () => {
    const periods: BusyPeriod[] = [
      { start: `${D}T14:00:00`, end: `${D}T15:00:00` },
      { start: `${D}T08:00:00`, end: `${D}T09:00:00` },
    ]
    expect(busyIntervalsForDay(periods, D)).toEqual([
      { start: 14, end: 15 },
      { start: 8, end: 9 },
    ])
  })

  it('skips malformed timestamps and handles empties', () => {
    expect(busyIntervalsForDay([{ start: 'nonsense', end: `${D}T10:00:00` }], D)).toEqual([])
    expect(busyIntervalsForDay([], D)).toEqual([])
    expect(busyIntervalsForDay([{ start: `${D}T09:00:00`, end: `${D}T10:00:00` }], 'bad-date')).toEqual([])
  })
})

const run: Activity = { id: 'run', name: 'Running', icon: '🏃', durationMins: 60, maxUV: 4, sunscreen: false }
const rec: SlotRecommendation = {
  start: 17, end: 18, earliestStart: 17, latestStart: 20,
  windowLabel: 'Afternoon', peakUV: 5, reason: 'Earliest free spot in your afternoon window',
}

describe('buildEventDescription', () => {
  it('explains the pick, flexibility, peak, and protection', () => {
    const d = buildEventDescription(rec, run, { peakUV: 7.8, peakHour: 15 })
    expect(d).toContain('Recommended for 5pm — earliest free spot in your afternoon window.')
    expect(d).toContain('Flexible: start anytime 5pm–8pm and stay in the safe window.')
    expect(d).toContain('Peak UV 7.8 around 3pm.')
    expect(d).toContain('Planned for no sunscreen.')
    expect(d).toContain('Planned by Solara')
  })

  it('omits the flexibility line when there is no wiggle room', () => {
    const tight = { ...rec, earliestStart: 17, latestStart: 17 }
    expect(buildEventDescription(tight, run)).not.toContain('Flexible')
  })

  it('omits the peak line when not provided and notes SPF when on', () => {
    const d = buildEventDescription(rec, { ...run, sunscreen: true })
    expect(d).not.toContain('Peak UV')
    expect(d).toContain('Assumes SPF 30+.')
  })
})

describe('buildEventBody', () => {
  it('builds summary and offset-free local timestamps', () => {
    const body = buildEventBody(run, '2026-05-29', 17, 18, 'desc', 'America/Los_Angeles')
    expect(body.summary).toBe('🏃 Running — sun window')
    expect(body.start).toEqual({ dateTime: '2026-05-29T17:00:00', timeZone: 'America/Los_Angeles' })
    expect(body.end).toEqual({ dateTime: '2026-05-29T18:00:00', timeZone: 'America/Los_Angeles' })
  })

  it('renders fractional hours as minutes', () => {
    const body = buildEventBody(run, '2026-05-29', 9.5, 10.25, 'desc', 'UTC')
    expect(body.start.dateTime).toBe('2026-05-29T09:30:00')
    expect(body.end.dateTime).toBe('2026-05-29T10:15:00')
  })
})
