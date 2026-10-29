// Core's time zone code must run on React Native's Hermes engine, whose Intl is smaller
// than a browser's or Node's. What Hermes documents (facebook/hermes doc/IntlAPIs.md,
// checked 2026-10-28):
//
// - Intl.DateTimeFormat: `supportedLocalesOf`, `format` and `resolvedOptions` on Android
//   and iOS; `formatToParts` is not listed for DateTimeFormat (only for NumberFormat, on
//   Android only), and neither are `formatRange` or `formatRangeToParts`.
// - Options not supported: `dayPeriod`, `fractionalSecondDigits` and `formatMatcher` on
//   Android; `numberingSystem` and `formatMatcher` on iOS. `hourCycle` is not mentioned,
//   so it is not relied on.
// - The `timeZone` option is supported (the IANA names come from the platform's ICU).
//
// zoned-time.ts therefore reads `format()` only. This test checks that reading against
// `formatToParts` (what core used before, and what browsers and Node have), then swaps in
// an Intl.DateTimeFormat with only Hermes's surface (no formatToParts, `hourCycle`
// ignored, the unsupported options refused) and checks that every zone-dependent function
// in core gives the same answers as with the full Intl.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as AlertsModule from './alerts'
import type * as SunModule from './sun-times'
import type * as ZonedModule from './zoned-time'

type Core = { zoned: typeof ZonedModule; alerts: typeof AlertsModule; sun: typeof SunModule }

const UNSUPPORTED = ['dayPeriod', 'fractionalSecondDigits', 'formatMatcher', 'numberingSystem']
const RealDateTimeFormat = Intl.DateTimeFormat

/** An Intl.DateTimeFormat limited to what Hermes documents. */
function hermesDateTimeFormat(
  locales?: string | string[],
  options: Intl.DateTimeFormatOptions = {},
) {
  for (const option of UNSUPPORTED) {
    if (option in options) throw new TypeError(`Hermes does not support ${option}`)
  }
  const { hourCycle: _ignored, ...rest } = options
  const real = new RealDateTimeFormat(locales, rest)
  return {
    format: (date?: Date | number) => real.format(date),
    resolvedOptions: () => real.resolvedOptions(),
  }
}
hermesDateTimeFormat.supportedLocalesOf = RealDateTimeFormat.supportedLocalesOf

async function loadCore(): Promise<Core> {
  vi.resetModules()
  return {
    zoned: await import('./zoned-time'),
    alerts: await import('./alerts'),
    sun: await import('./sun-times'),
  }
}

const ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Adelaide',
  'Pacific/Kiritimati',
  'Pacific/Chatham',
]

// Every 7 hours 13 minutes through 2026 (both DST changes in each hemisphere), plus
// midnights and the instants either side of the US and EU changes.
const INSTANTS = [
  ...Array.from(
    { length: 1220 },
    (_, i) => Date.UTC(2026, 0, 1) + i * (7 * 3_600_000 + 13 * 60_000),
  ),
  Date.UTC(2026, 2, 8, 9, 59, 59),
  Date.UTC(2026, 2, 8, 10, 0, 0),
  Date.UTC(2026, 2, 29, 0, 59, 59),
  Date.UTC(2026, 2, 29, 1, 0, 0),
  Date.UTC(2026, 10, 1, 8, 59, 59),
  Date.UTC(2026, 10, 1, 9, 0, 0),
  Date.UTC(2026, 5, 15, 7, 0, 0),
  Date.UTC(2026, 5, 15, 0, 0, 0),
]

let full: Core
let hermes: Core

beforeAll(async () => {
  full = await loadCore()
  vi.stubGlobal('Intl', { ...Intl, DateTimeFormat: hermesDateTimeFormat })
  hermes = await loadCore()
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('core time zones on a Hermes-like Intl', () => {
  it('really runs without formatToParts', () => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' })
    expect('formatToParts' in formatter).toBe(false)
    expect(() => new Intl.DateTimeFormat('en-US', { dayPeriod: 'short' })).toThrow(TypeError)
  })

  it.each(ZONES)('reads the wall clock formatToParts gives in %s', zone => {
    const reference = new RealDateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    for (const ms of INSTANTS) {
      const parts = Object.fromEntries(
        reference
          .formatToParts(new Date(ms))
          .filter(part => part.type !== 'literal')
          .map(part => [part.type, Number(part.value)]),
      )
      expect(full.zoned.wallClockAt(ms, zone)).toEqual({ ...parts, hour: parts.hour! % 24 })
    }
  })

  it.each(ZONES)('reads the same wall clock and local time in %s', zone => {
    for (const ms of INSTANTS) {
      expect(hermes.zoned.wallClockAt(ms, zone)).toEqual(full.zoned.wallClockAt(ms, zone))
      expect(hermes.alerts.localTime(new Date(ms), zone)).toEqual(
        full.alerts.localTime(new Date(ms), zone),
      )
    }
  })

  it.each(ZONES)('finds the same instants, offsets and dates in %s', zone => {
    for (const ms of INSTANTS.slice(0, 200)) {
      const local = full.zoned.wallClockAt(ms, zone)
      expect(hermes.zoned.instantInZone(local, zone)).toBe(full.zoned.instantInZone(local, zone))
      expect(hermes.zoned.zoneOffsetMs(ms, zone)).toBe(full.zoned.zoneOffsetMs(ms, zone))
      expect(hermes.zoned.zonedDate(ms, zone)).toBe(full.zoned.zonedDate(ms, zone))
    }
  })

  it('works out the same sunrise, sunset and phase', () => {
    const places = [
      { lat: 35.28, lon: -120.66, zone: 'America/Los_Angeles' },
      { lat: 51.5, lon: -0.12, zone: 'Europe/London' },
      { lat: -34.93, lon: 138.6, zone: 'Australia/Adelaide' },
      { lat: 69.65, lon: 18.96, zone: 'Europe/Oslo' },
    ]
    for (const { lat, lon, zone } of places) {
      for (const date of ['2026-01-15', '2026-03-29', '2026-06-21', '2026-11-01']) {
        expect(hermes.sun.sunTimes(lat, lon, date, zone)).toEqual(
          full.sun.sunTimes(lat, lon, date, zone),
        )
        expect(hermes.sun.daylightHours({ lat, lon }, date, zone)).toEqual(
          full.sun.daylightHours({ lat, lon }, date, zone),
        )
      }
      for (const ms of INSTANTS.slice(0, 100)) {
        expect(hermes.sun.sunPhaseAt({ lat, lon }, zone, ms)).toBe(
          full.sun.sunPhaseAt({ lat, lon }, zone, ms),
        )
      }
    }
  })

  it('still refuses an unknown zone', () => {
    expect(hermes.zoned.isIanaTimeZone('Mars/Olympus')).toBe(false)
    expect(hermes.alerts.localTime(new Date(), 'Mars/Olympus')).toBeNull()
    expect(hermes.sun.sunTimes(0, 0, '2026-06-15', 'Mars/Olympus')).toBeNull()
  })
})
