import { describe, expect, it } from 'vitest'
import { sunPhaseAt, sunTimes } from './sun-times'
import { zonedNow } from './time'

/** "HH:MM" in `timeZone` for an instant. */
const clock = (ms: number, timeZone: string) => {
  const now = zonedNow(timeZone, ms)
  return `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Within `slack` minutes of the published time. */
function near(ms: number, timeZone: string, expected: string, slack = 3) {
  expect(Math.abs(minutes(clock(ms, timeZone)) - minutes(expected))).toBeLessThanOrEqual(slack)
}

const LA = { lat: 34.05, lon: -118.24 }
const SYDNEY = { lat: -33.87, lon: 151.21 }
const TROMSO = { lat: 69.65, lon: 18.96 }

describe('sunTimes', () => {
  // Reference times, to within 3 minutes: the NOAA equations worked by hand, which match
  // the published almanac times for Los Angeles and Tokyo.
  it.each([
    ['Los Angeles in October', LA, '2026-10-28', 'America/Los_Angeles', '07:09', '18:04'],
    ['Los Angeles in June', LA, '2026-06-15', 'America/Los_Angeles', '05:41', '20:06'],
    ['Sydney in October', SYDNEY, '2026-10-28', 'Australia/Sydney', '05:58', '19:19'],
    ['Tokyo in January', { lat: 35.68, lon: 139.69 }, '2026-01-15', 'Asia/Tokyo', '06:50', '16:51'],
    // A zone far from its meridian, across the date line: noon falls on the UTC day before.
    ['Apia', { lat: -13.83, lon: -171.76 }, '2026-06-15', 'Pacific/Apia', '06:48', '18:06'],
  ])('%s', (_name, place, date, timeZone, sunrise, sunset) => {
    const sun = sunTimes(place.lat, place.lon, date, timeZone)
    expect(sun?.kind).toBe('rises')
    if (sun?.kind !== 'rises') return
    near(sun.sunrise, timeZone, sunrise)
    near(sun.sunset, timeZone, sunset)
    expect(zonedNow(timeZone, sun.sunrise).date).toBe(date)
  })

  it('knows the midnight sun and the polar night', () => {
    expect(sunTimes(TROMSO.lat, TROMSO.lon, '2026-06-21', 'Europe/Oslo')).toEqual({
      kind: 'polar-day',
    })
    expect(sunTimes(TROMSO.lat, TROMSO.lon, '2026-12-21', 'Europe/Oslo')).toEqual({
      kind: 'polar-night',
    })
  })

  it('refuses what it cannot use', () => {
    expect(sunTimes(Number.NaN, 0, '2026-06-15', 'UTC')).toBeNull()
    expect(sunTimes(95, 0, '2026-06-15', 'UTC')).toBeNull()
    expect(sunTimes(0, 0, 'not-a-date', 'UTC')).toBeNull()
  })
})

describe('sunPhaseAt', () => {
  const at = (iso: string) => Date.parse(iso)

  it('says the sun is up at 8:05am in Los Angeles in October, though UV is still low', () => {
    const zone = 'America/Los_Angeles'
    expect(sunPhaseAt(LA, zone, at('2026-10-28T07:00:00-07:00'))).toBe('before-sunrise')
    expect(sunPhaseAt(LA, zone, at('2026-10-28T08:05:00-07:00'))).toBe('up')
    expect(sunPhaseAt(LA, zone, at('2026-10-28T17:55:00-07:00'))).toBe('up')
    expect(sunPhaseAt(LA, zone, at('2026-10-28T18:10:00-07:00'))).toBe('after-sunset')
    expect(sunPhaseAt(LA, zone, at('2026-10-28T23:59:00-07:00'))).toBe('after-sunset')
    expect(sunPhaseAt(LA, zone, at('2026-10-29T00:01:00-07:00'))).toBe('before-sunrise')
  })

  it("reads the place's own day, wherever the device is", () => {
    const zone = 'Australia/Sydney'
    expect(sunPhaseAt(SYDNEY, zone, at('2026-10-28T05:30:00+11:00'))).toBe('before-sunrise')
    expect(sunPhaseAt(SYDNEY, zone, at('2026-10-28T06:30:00+11:00'))).toBe('up')
    expect(sunPhaseAt(SYDNEY, zone, at('2026-10-28T19:50:00+11:00'))).toBe('after-sunset')
  })

  it('is up all day under the midnight sun and down all day in the polar night', () => {
    expect(sunPhaseAt(TROMSO, 'Europe/Oslo', at('2026-06-21T01:00:00+02:00'))).toBe('up')
    expect(sunPhaseAt(TROMSO, 'Europe/Oslo', at('2026-12-21T12:00:00+01:00'))).toBe('after-sunset')
  })
})
