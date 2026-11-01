import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANNABLE_HOURS,
  forecastClock,
  forecastPlannableHours,
  hourlyRows,
  isPlannableHour,
  parseOpenMeteoResponse,
  plannableHours,
  type OpenMeteoPayload,
} from './forecast'

// REVIEW10 VERIFY10 N1: with `timezone=auto`, Open-Meteo writes every hourly label with
// the one UTC offset in force when the forecast is fetched (utc_offset_seconds), so the
// days after a daylight saving change are labelled an hour off. These fixtures are built
// that way: UV follows the real sun (a peak at the place's solar noon, in UTC), and the
// labels carry the fetch-time offset for every day, as Open-Meteo sends them.

const HOUR = 3_600_000

/**
 * A forecast as Open-Meteo answers it when fetched on `fetchDay`: `days` days of hourly
 * labels written with `offsetSeconds`, starting at that offset's midnight of `fetchDay`,
 * and a UV of `peak - |hours from solar noon|` (never below 0), solar noon at
 * `noonUtcHour` every day.
 */
function forecastFetchedOn({
  fetchDay,
  days,
  offsetSeconds,
  timezone,
  noonUtcHour,
  latitude,
  longitude,
  peak = 8,
}: {
  fetchDay: string
  days: number
  offsetSeconds: number
  timezone: string
  noonUtcHour: number
  latitude?: number
  longitude?: number
  peak?: number
}): OpenMeteoPayload {
  const start = Date.parse(`${fetchDay}T00:00:00Z`) - offsetSeconds * 1000
  const time: string[] = []
  const uv: number[] = []
  for (let i = 0; i < days * 24; i++) {
    const instant = start + i * HOUR
    const label = new Date(instant + offsetSeconds * 1000).toISOString().slice(0, 16)
    const utcHour = new Date(instant).getUTCHours()
    const fromNoon = Math.min(Math.abs(utcHour - noonUtcHour), 24 - Math.abs(utcHour - noonUtcHour))
    time.push(label)
    uv.push(Math.max(0, peak - fromNoon))
  }
  return {
    timezone,
    utc_offset_seconds: offsetSeconds,
    ...(latitude !== undefined && { latitude, longitude }),
    hourly: { time, uv_index: uv },
  }
}

/** The local hour of each date's highest UV. */
function peakHours(raw: OpenMeteoPayload): Record<string, number> {
  const peaks: Record<string, { hour: number; uv: number }> = {}
  for (const row of hourlyRows(parseOpenMeteoResponse(raw))) {
    const best = peaks[row.date]
    if (row.uv !== null && (!best || row.uv > best.uv))
      peaks[row.date] = { hour: row.hour, uv: row.uv }
  }
  return Object.fromEntries(Object.entries(peaks).map(([date, { hour }]) => [date, hour]))
}

/** The local hours of `date`, in order. */
function hoursOn(raw: OpenMeteoPayload, date: string): number[] {
  return hourlyRows(parseOpenMeteoResponse(raw))
    .filter(row => row.date === date)
    .map(row => row.hour)
}

describe('forecast hours across a daylight saving change (REVIEW10 VERIFY10 N1)', () => {
  // New York: solar noon about 17:00 UTC, which is 12pm EST and 1pm EDT.
  it('US spring forward: the days after the change peak at 1pm, not 12pm', () => {
    // Fetched on Thursday 5 March 2026 (EST, -5); the clocks go forward on Sunday 8 March.
    const raw = forecastFetchedOn({
      fetchDay: '2026-03-05',
      days: 7,
      offsetSeconds: -5 * 3600,
      timezone: 'America/New_York',
      noonUtcHour: 17,
    })
    // Seven days of labels end on the clock at midnight of 12 March, a day of one hour.
    expect(peakHours(raw)).toMatchObject({
      '2026-03-05': 12,
      '2026-03-06': 12,
      '2026-03-07': 12,
      '2026-03-08': 13,
      '2026-03-09': 13,
      '2026-03-10': 13,
      '2026-03-11': 13,
    })
    // The change day has 23 hours: 2am never happens on the clock.
    const changeDay = hoursOn(raw, '2026-03-08')
    expect(changeDay).toHaveLength(23)
    expect(changeDay).not.toContain(2)
    expect(hoursOn(raw, '2026-03-09')).toEqual([...Array(24).keys()])
  })

  it('US fall back: the days after the change peak at 12pm, not 1pm', () => {
    // Fetched on Thursday 29 October 2026 (EDT, -4); the clocks go back on Sunday 1 November.
    const raw = forecastFetchedOn({
      fetchDay: '2026-10-29',
      days: 7,
      offsetSeconds: -4 * 3600,
      timezone: 'America/New_York',
      noonUtcHour: 17,
    })
    expect(peakHours(raw)).toMatchObject({
      '2026-10-29': 13,
      '2026-10-31': 13,
      '2026-11-01': 12,
      '2026-11-02': 12,
      '2026-11-04': 12,
    })
    // The change day's 1am happens twice; it keeps one row, the first.
    const changeDay = hoursOn(raw, '2026-11-01')
    expect(changeDay).toEqual([...Array(24).keys()])
  })

  it('southern hemisphere spring forward (Sydney, October)', () => {
    // Sydney: solar noon about 01:50 UTC (11:50am AEST, 12:50pm AEDT); the clocks go
    // forward on Sunday 4 October 2026. Fetched on 1 October (AEST, +10).
    const raw = forecastFetchedOn({
      fetchDay: '2026-10-01',
      days: 7,
      offsetSeconds: 10 * 3600,
      timezone: 'Australia/Sydney',
      noonUtcHour: 2,
    })
    expect(peakHours(raw)).toMatchObject({
      '2026-10-01': 12,
      '2026-10-03': 12,
      '2026-10-05': 13,
      '2026-10-07': 13,
    })
  })

  it('southern hemisphere fall back (Sydney, April)', () => {
    // The clocks go back on Sunday 5 April 2026. Fetched on 2 April (AEDT, +11).
    const raw = forecastFetchedOn({
      fetchDay: '2026-04-02',
      days: 7,
      offsetSeconds: 11 * 3600,
      timezone: 'Australia/Sydney',
      noonUtcHour: 2,
    })
    expect(peakHours(raw)).toMatchObject({
      '2026-04-02': 13,
      '2026-04-04': 13,
      '2026-04-06': 12,
      '2026-04-08': 12,
    })
  })

  it('reads a response without the offset or zone as written (an older cached copy)', () => {
    const raw = forecastFetchedOn({
      fetchDay: '2026-03-05',
      days: 7,
      offsetSeconds: -5 * 3600,
      timezone: 'America/New_York',
      noonUtcHour: 17,
    })
    const { utc_offset_seconds: _offset, ...withoutOffset } = raw
    expect(peakHours(withoutOffset)['2026-03-09']).toBe(12)
    expect(
      forecastClock({ timezone: 'Not/AZone', utc_offset_seconds: 0 })('2026-03-09T12:00'),
    ).toEqual({
      date: '2026-03-09',
      hour: 12,
    })
  })

  it('keeps whole-hour zones that are not on a whole-hour offset (Kathmandu, +5:45)', () => {
    const clock = forecastClock({ timezone: 'Asia/Kathmandu', utc_offset_seconds: 20_700 })
    expect(clock('2026-06-15T14:00')).toEqual({ date: '2026-06-15', hour: 14 })
    expect(clock('2026-06-15T00:00')).toEqual({ date: '2026-06-15', hour: 0 })
    expect(clock('garbage')).toBeNull()
  })
})

describe('plannable hours follow the sun (REVIEW10 VERIFY10 N7)', () => {
  it('is 6:00-20:59 by default and for an ordinary day', () => {
    expect(plannableHours(null)).toEqual(DEFAULT_PLANNABLE_HOURS)
    expect(plannableHours({ from: 0, to: 0 })).toEqual({ first: 6, last: 20 })
    expect(plannableHours({ from: 7.2, to: 18 })).toEqual({ first: 6, last: 20 })
  })

  it('widens to every hour the sun is up', () => {
    expect(plannableHours({ from: 0, to: 24 })).toEqual({ first: 0, last: 23 })
    expect(plannableHours({ from: 7.5, to: 21.67 })).toEqual({ first: 6, last: 21 })
    expect(plannableHours({ from: 4.75, to: 20 })).toEqual({ first: 4, last: 20 })
  })

  it('keeps the evening of a polar day (McMurdo) and of Kashgar on Beijing time', () => {
    const mcmurdo = forecastFetchedOn({
      fetchDay: '2026-12-20',
      days: 1,
      offsetSeconds: 13 * 3600,
      timezone: 'Antarctica/McMurdo',
      noonUtcHour: 0,
      latitude: -77.85,
      longitude: 166.67,
    })
    const range = forecastPlannableHours(mcmurdo, '2026-12-20')
    expect(range).toEqual({ first: 0, last: 23 })
    const rows = hourlyRows(parseOpenMeteoResponse(mcmurdo)).filter(row =>
      isPlannableHour(row, range),
    )
    expect(rows.map(row => row.hour)).toContain(21)
    expect(rows.map(row => row.hour)).toContain(23)

    // Kashgar sets just after 22:00 Beijing time in June.
    const kashgar = forecastPlannableHours(
      { latitude: 39.47, longitude: 75.99, timezone: 'Asia/Shanghai' },
      '2026-06-21',
    )
    expect(kashgar).toEqual({ first: 6, last: 22 })
  })

  it('falls back to 6:00-20:59 without a position', () => {
    expect(forecastPlannableHours({ timezone: 'Asia/Shanghai' }, '2026-06-21')).toEqual(
      DEFAULT_PLANNABLE_HOURS,
    )
  })
})
