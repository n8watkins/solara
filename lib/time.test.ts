import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayOfMonth,
  daysBetween,
  formatDate,
  fractionalHour,
  isIsoDate,
  isValidTimeZone,
  msUntilNextMinute,
  resolveTimeZone,
  zonedInstant,
  zonedNow,
} from '@/lib/time'
import { withDeviceZones } from './test-zones'

const LA = 'America/Los_Angeles'
// 2026-06-15 10:30 in Los Angeles (PDT, UTC-7) = 17:30 UTC = 2026-06-16 02:30 in Tokyo.
const INSTANT = Date.parse('2026-06-15T17:30:00Z')

describe('zonedNow', () => {
  it('reads the date and time in the given zone, whatever the device zone', () => {
    const results = withDeviceZones(() => ({
      la: zonedNow(LA, INSTANT),
      tokyo: zonedNow('Asia/Tokyo', INSTANT),
      utc: zonedNow('UTC', INSTANT),
    }))
    for (const result of Object.values(results)) {
      expect(result.la).toMatchObject({ date: '2026-06-15', hour: 10, minute: 30 })
      expect(result.tokyo).toMatchObject({ date: '2026-06-16', hour: 2, minute: 30 })
      expect(result.utc).toMatchObject({ date: '2026-06-15', hour: 17, minute: 30 })
    }
  })

  it('reports midnight as hour 0', () => {
    expect(zonedNow(LA, Date.parse('2026-06-16T07:00:00Z'))).toMatchObject({
      date: '2026-06-16',
      hour: 0,
      minute: 0,
    })
  })

  it('gives fractional hours', () => {
    expect(fractionalHour({ hour: 10, minute: 30 })).toBe(10.5)
  })
})

describe('calendar dates', () => {
  it('adds days across month and year ends and counts days between', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-06-15', '2026-06-25')).toBe(10)
    expect(dayOfMonth('2026-06-07')).toBe(7)
  })

  it('validates dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-6-1')).toBe(false)
    expect(() => addDays('nope', 1)).toThrow()
  })

  it('formats a date label without the device zone moving it', () => {
    const labels = withDeviceZones(() =>
      formatDate('2026-06-15', { weekday: 'short', month: 'short', day: 'numeric' }),
    )
    expect(new Set(Object.values(labels))).toEqual(new Set(['Mon, Jun 15']))
  })
})

describe('zonedInstant', () => {
  it('maps a wall time in a zone to the right instant on any device', () => {
    const results = withDeviceZones(() => [
      zonedInstant('2026-06-15', 10.5, LA),
      zonedInstant('2026-06-16', 2.5, 'Asia/Tokyo'),
      zonedInstant('2026-01-15', 9, 'Europe/London'),
    ])
    for (const result of Object.values(results)) {
      expect(result).toEqual([INSTANT, INSTANT, Date.parse('2026-01-15T09:00:00Z')])
    }
  })

  it('handles DST transitions', () => {
    // Spring forward (2026-03-08, LA): midnight is PST, 23:00 is PDT.
    expect(zonedInstant('2026-03-08', 0, LA)).toBe(Date.parse('2026-03-08T08:00:00Z'))
    expect(zonedInstant('2026-03-08', 23, LA)).toBe(Date.parse('2026-03-09T06:00:00Z'))
    // Fall back (2026-11-01, LA): 1:30 happens twice; the first is used.
    expect(zonedInstant('2026-11-01', 1.5, LA)).toBe(Date.parse('2026-11-01T08:30:00Z'))
    expect(zonedInstant('2026-11-02', 0, LA) - zonedInstant('2026-11-01', 0, LA)).toBe(
      25 * 3_600_000,
    )
  })

  it('returns NaN for an invalid date', () => {
    expect(zonedInstant('bad', 1, LA)).toBeNaN()
  })
})

describe('time zones', () => {
  it('validates and resolves zones, falling back to the device', () => {
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
    expect(resolveTimeZone(undefined, 'Bad/Zone', 'Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(withDeviceZones(() => resolveTimeZone(undefined))).toEqual({
      UTC: 'UTC',
      'Asia/Tokyo': 'Asia/Tokyo',
      'America/Los_Angeles': 'America/Los_Angeles',
    })
  })
})

describe('clock helpers', () => {
  it('counts to the next minute', () => {
    expect(msUntilNextMinute(Date.parse('2026-06-15T10:30:15Z'))).toBe(45_000)
    expect(msUntilNextMinute(Date.parse('2026-06-15T10:30:00Z'))).toBe(60_000)
  })
})
