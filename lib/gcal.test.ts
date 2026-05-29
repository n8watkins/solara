import { describe, it, expect } from 'vitest'
import { busyIntervalsForDay, BusyPeriod } from '@/lib/gcal'

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
