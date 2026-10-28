import { describe, expect, it } from 'vitest'
import { daylightHours, normalizeLongitude, sunPhaseAt, sunTimes } from './sun-times'
import { wallClockAt, zonedDate } from './zoned-time'

/** "HH:MM" in `timeZone` for an instant. */
const clock = (ms: number, timeZone: string) => {
  const now = wallClockAt(ms, timeZone)
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
    expect(zonedDate(sun.sunrise, timeZone)).toBe(date)
  })

  it('knows the midnight sun and the polar night', () => {
    expect(sunTimes(TROMSO.lat, TROMSO.lon, '2026-06-21', 'Europe/Oslo')).toEqual({
      kind: 'polar-day',
    })
    expect(sunTimes(TROMSO.lat, TROMSO.lon, '2026-12-21', 'Europe/Oslo')).toEqual({
      kind: 'polar-night',
    })
  })

  it('gives the same sun at the date line whether it is called -180 or 180 (REVIEW7 L7.4)', () => {
    // Fiji's zone is 12 hours ahead of UTC, so its noon at the date line is 00:00 UTC; at
    // exactly -180 every noon tried used to fall on the wrong local date.
    const east = sunTimes(-16.5, 180, '2026-10-28', 'Pacific/Fiji')
    const west = sunTimes(-16.5, -180, '2026-10-28', 'Pacific/Fiji')
    expect(east?.kind).toBe('rises')
    expect(west).toEqual(east)
    // A longitude written past the date line is the same place.
    expect(sunTimes(-16.5, 540, '2026-10-28', 'Pacific/Fiji')).toEqual(east)
    expect(sunTimes(LA.lat, LA.lon + 360, '2026-10-28', 'America/Los_Angeles')).toEqual(
      sunTimes(LA.lat, LA.lon, '2026-10-28', 'America/Los_Angeles'),
    )
    expect(daylightHours({ lat: -16.5, lon: -180 }, '2026-10-28', 'Pacific/Fiji')).toEqual(
      daylightHours({ lat: -16.5, lon: 180 }, '2026-10-28', 'Pacific/Fiji'),
    )
  })

  it('finds the sun for every longitude, on the place’s own date', () => {
    for (let lon = -180; lon <= 180; lon += 7.5) {
      for (const timeZone of ['UTC', 'Pacific/Fiji', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        const sun = sunTimes(10, lon, '2026-10-28', timeZone)
        expect(sun?.kind, `${lon} ${timeZone}`).toBe('rises')
      }
    }
  })

  it('refuses what it cannot use', () => {
    expect(sunTimes(Number.NaN, 0, '2026-06-15', 'UTC')).toBeNull()
    expect(sunTimes(95, 0, '2026-06-15', 'UTC')).toBeNull()
    expect(sunTimes(0, 0, 'not-a-date', 'UTC')).toBeNull()
  })
})

describe('normalizeLongitude', () => {
  it('names every longitude once, in (-180, 180]', () => {
    expect(normalizeLongitude(-180)).toBe(180)
    expect(normalizeLongitude(180)).toBe(180)
    expect(normalizeLongitude(0)).toBe(0)
    expect(normalizeLongitude(-118.24)).toBeCloseTo(-118.24, 10)
    expect(normalizeLongitude(181)).toBe(-179)
    expect(normalizeLongitude(-181)).toBe(179)
    expect(normalizeLongitude(540)).toBe(180)
    expect(normalizeLongitude(-540)).toBe(180)
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

describe('daylightHours', () => {
  it('rounds sunrise up and sunset down to the 5-minute steps slots use', () => {
    // Sunrise 7:09am, sunset 6:04pm.
    expect(daylightHours(LA, '2026-10-28', 'America/Los_Angeles')).toEqual({
      from: 7 + 10 / 60,
      to: 18,
    })
    // Sunrise 5:58am, sunset 7:19pm.
    expect(daylightHours(SYDNEY, '2026-10-28', 'Australia/Sydney')).toEqual({
      from: 6,
      to: 19 + 15 / 60,
    })
  })

  it('is the whole day under the midnight sun and none in the polar night', () => {
    expect(daylightHours(TROMSO, '2026-06-21', 'Europe/Oslo')).toEqual({ from: 0, to: 24 })
    expect(daylightHours(TROMSO, '2026-12-21', 'Europe/Oslo')).toEqual({ from: 0, to: 0 })
  })

  it('is unknown for a place or zone it cannot use', () => {
    expect(daylightHours({ lat: Number.NaN, lon: 0 }, '2026-10-28', 'UTC')).toBeNull()
    expect(daylightHours(LA, '2026-10-28', 'Not/AZone')).toBeNull()
    expect(daylightHours(LA, '2026-10-28', '')).toBeNull()
  })
})
