import { describe, expect, it } from 'vitest'
import { forecastStamp } from './offline'
import { zonedNow } from './time'
import { formatClockTime } from './units'

const ZONE = 'America/Los_Angeles'
const NOW = Date.parse('2026-06-15T10:30:00-07:00')
const now = zonedNow(ZONE, NOW)

describe('forecastStamp', () => {
  it('says the time for a forecast from today, in the location zone and display units', () => {
    const at = Date.parse('2026-06-15T09:15:00-07:00')
    expect(forecastStamp(at, now, hours => formatClockTime(hours, '12h'))).toBe('9:15am')
    expect(forecastStamp(at, now, hours => formatClockTime(hours, '24h'))).toBe('09:15')
    // The device zone never matters: the same instant in Tokyo's clock is another day.
    expect(forecastStamp(at, zonedNow('Asia/Tokyo', NOW), h => formatClockTime(h))).toBe('1:15am')
  })

  it('names yesterday and older days', () => {
    const yesterday = Date.parse('2026-06-14T21:05:00-07:00')
    expect(forecastStamp(yesterday, now, h => formatClockTime(h))).toBe('yesterday, 9:05pm')
    const older = Date.parse('2026-06-12T08:00:00-07:00')
    expect(forecastStamp(older, now, h => formatClockTime(h))).toBe('Jun 12, 8am')
  })
})
