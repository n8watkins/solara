import { describe, expect, it } from 'vitest'
import {
  eventBurn,
  eventUV,
  importedEventExpiry,
  importedEventKey,
  importedSeriesId,
  matchActivity,
  parseImportedEvent,
  sunscreenTiming,
  type HourUV,
} from './events'
import { parseIcs } from './ics-parse'
import { instantInZone, shiftIsoDate, wallClockAt, zonedDate } from './zoned-time'

const LA = 'America/Los_Angeles'
const at = (local: string) => {
  const [date, time] = local.split('T')
  const [year, month, day] = date!.split('-').map(Number)
  const [hour, minute] = time!.split(':').map(Number)
  return instantInZone(
    { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: 0 },
    LA,
  )
}

const valid = {
  key: 'a'.repeat(32),
  source: 'file',
  seriesId: 'fedcba9876543210fedcba9876543210',
  title: 'Saturday 10K',
  start: '2026-06-20T15:00:00.000Z',
  end: '2026-06-20T16:30:00.000Z',
  timeZone: LA,
  where: 'Griffith Park',
  lat: 34.14,
  lon: -118.29,
  placeLabel: 'Los Angeles, California',
  placeGuessed: false,
  activityId: 'run',
  url: 'https://example.com/run',
  createdAt: '2026-06-15T17:30:00.000Z',
  updatedAt: '2026-06-15T17:30:00.000Z',
}

describe('zoned time', () => {
  it('converts wall-clock times and back across daylight saving', () => {
    expect(new Date(at('2026-06-20T08:00')).toISOString()).toBe('2026-06-20T15:00:00.000Z')
    expect(new Date(at('2026-12-20T08:00')).toISOString()).toBe('2026-12-20T16:00:00.000Z')
    expect(wallClockAt(Date.parse('2026-06-20T15:00:00Z'), LA)).toMatchObject({ hour: 8, day: 20 })
    expect(zonedDate(Date.parse('2026-06-21T06:00:00Z'), LA)).toBe('2026-06-20')
    expect(shiftIsoDate('2026-02-27', 2)).toBe('2026-03-01')
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('stored imported events', () => {
  it('accepts a valid record and drops unknown fields', () => {
    expect(parseImportedEvent({ ...valid, description: 'x' })).toEqual(valid)
    expect(parseImportedEvent({ ...valid, url: '' })).toMatchObject({ url: '' })
  })

  it.each([
    ['key', 'not-hex'],
    ['source', 'strava'],
    ['seriesId', 'ABC'],
    ['title', 'x'.repeat(201)],
    ['start', 'yesterday'],
    ['timeZone', 'Nowhere/Special'],
    ['where', 'x'.repeat(201)],
    ['lat', 91],
    ['lon', Number.NaN],
    ['placeLabel', 'x'.repeat(121)],
    ['placeGuessed', 'yes'],
    ['activityId', 'x'.repeat(65)],
    ['url', 'javascript:alert(1)'],
    ['url', 'http://example.com'],
  ])('rejects a bad %s', (field, value) => {
    expect(parseImportedEvent({ ...valid, [field]: value })).toBeNull()
  })

  it('rejects an event that ends before it starts', () => {
    expect(parseImportedEvent({ ...valid, end: valid.start })).toBeNull()
  })

  it('expires 30 days after the event ends', () => {
    expect(importedEventExpiry(valid).toISOString()).toBe('2026-07-20T16:30:00.000Z')
  })
})

describe('keys', () => {
  it('are 32 hex characters, stable, and differ per occurrence and per series', async () => {
    const one = await importedEventKey('file', 'uid-1', null)
    expect(one).toMatch(/^[0-9a-f]{32}$/)
    expect(await importedEventKey('file', 'uid-1', null)).toBe(one)
    expect(await importedEventKey('file', 'uid-1', '2026-06-20T15:00:00.000Z')).not.toBe(one)
    expect(await importedEventKey('file', 'uid-2', null)).not.toBe(one)
    expect(await importedSeriesId('file', 'uid-1')).toMatch(/^[0-9a-f]{32}$/)
    expect(await importedSeriesId('file', 'uid-1')).not.toBe(one)
  })
})

describe('matchActivity', () => {
  const activities = [
    { id: 'run', name: 'Running' },
    { id: 'hike', name: 'Hiking' },
    { id: 'custom_1', name: 'Beach volleyball' },
  ]

  it('matches an activity named in the title', () => {
    expect(matchActivity('Sunday beach volleyball!', activities)).toBe('custom_1')
    expect(matchActivity('Morning RUNNING club', activities)).toBe('run')
  })

  it('matches preset keywords as whole words', () => {
    expect(matchActivity('Saturday 10K', activities)).toBe('run')
    expect(matchActivity('Griffith Park trail hike', activities)).toBe('hike')
    expect(matchActivity('Brunch', activities)).toBe('')
    // "trail run" is the longer keyword, so it wins over "trail".
    expect(matchActivity('Trail run', activities)).toBe('run')
  })

  it('only offers the person’s own activities', () => {
    expect(matchActivity('Swim meet', activities)).toBe('')
    expect(matchActivity('', activities)).toBe('')
  })
})

describe('eventUV', () => {
  // 06-20 hourly UV for Los Angeles in June.
  const june: HourUV[] = [
    { hour: 6, uv: 0.2 },
    { hour: 7, uv: 1 },
    { hour: 8, uv: 2.5 },
    { hour: 9, uv: 4.5 },
    { hour: 10, uv: 6.5 },
    { hour: 11, uv: 8.2 },
    { hour: 12, uv: 9.4 },
    { hour: 13, uv: 9 },
    { hour: 14, uv: 7.6 },
    { hour: 15, uv: 5.6 },
    { hour: 16, uv: 3.4 },
    { hour: 17, uv: 1.6 },
    { hour: 18, uv: 0.6 },
    { hour: 19, uv: 0.1 },
    { hour: 20, uv: 0 },
  ]
  const forecast = new Map([
    ['2026-06-15', june],
    ['2026-06-16', june],
  ])
  const base = {
    timeZone: LA,
    hoursOn: (date: string) => forecast.get(date),
    planDays: 2,
    today: '2026-06-15',
  }

  it('takes the peak and the time-weighted average over the event', () => {
    const uv = eventUV({ ...base, start: at('2026-06-16T08:30'), end: at('2026-06-16T10:30') })
    // 30 min at 2.5, 60 at 4.5, 30 at 6.5.
    expect(uv).toEqual({
      kind: 'forecast',
      peakUV: 6.5,
      avgUV: 4.5,
      peakAt: at('2026-06-16T10:00'),
      forecastPeakUV: 6.5,
    })
  })

  it('applies the activity’s shade and surface', () => {
    const uv = eventUV({
      ...base,
      start: at('2026-06-16T12:00'),
      end: at('2026-06-16T13:00'),
      activity: { shade: 'partial', surface: 'sand' },
    })
    expect(uv).toMatchObject({ kind: 'forecast', peakUV: 8.5, forecastPeakUV: 9.4 })
  })

  it('plans for a clear sky unless the activity plans with the clouds', () => {
    const cloudy = new Map([
      ['2026-06-16', june.map(h => (h.hour === 12 ? { ...h, uv: 6, clearSkyUV: 9.4 } : h))],
    ])
    const input = {
      ...base,
      hoursOn: (date: string) => cloudy.get(date),
      start: at('2026-06-16T12:00'),
      end: at('2026-06-16T13:00'),
    }
    expect(eventUV(input)).toMatchObject({ peakUV: 9.4, forecastPeakUV: 9.4 })
    expect(eventUV({ ...input, activity: { cloudSensitive: true } })).toMatchObject({
      peakUV: 6,
      forecastPeakUV: 6,
    })
  })

  it('counts night hours as UV 0 and skips missing daytime hours', () => {
    const gappy = new Map([['2026-06-16', june.filter(h => h.hour !== 12)]])
    const uv = eventUV({
      ...base,
      hoursOn: date => gappy.get(date),
      start: at('2026-06-16T11:30'),
      end: at('2026-06-16T12:30'),
    })
    expect(uv).toMatchObject({ kind: 'forecast', peakUV: 8.2, avgUV: 8.2 })
    const night = eventUV({ ...base, start: at('2026-06-15T21:00'), end: at('2026-06-15T22:00') })
    expect(night).toMatchObject({ kind: 'forecast', peakUV: 0, avgUV: 0 })
  })

  it('says when an event past the plan becomes live', () => {
    expect(
      eventUV({ ...base, start: at('2026-06-20T08:00'), end: at('2026-06-20T09:00') }),
    ).toEqual({ kind: 'later', fromDate: '2026-06-19' })
    // On Pro the plan reaches it, but a date the forecast does not have is not guessed.
    expect(
      eventUV({
        ...base,
        planDays: 10,
        start: at('2026-06-20T08:00'),
        end: at('2026-06-20T09:00'),
      }),
    ).toEqual({ kind: 'unknown' })
    expect(
      eventUV({
        ...base,
        planDays: 10,
        start: at('2026-06-30T08:00'),
        end: at('2026-06-30T09:00'),
      }),
    ).toEqual({ kind: 'later', fromDate: '2026-06-21' })
  })

  it('reports unknown when every daytime hour is missing', () => {
    expect(
      eventUV({
        ...base,
        hoursOn: () => [],
        start: at('2026-06-16T09:00'),
        end: at('2026-06-16T10:00'),
      }),
    ).toEqual({ kind: 'unknown' })
  })

  it('measures an event already under way from its start', () => {
    const uv = eventUV({ ...base, start: at('2026-06-15T09:00'), end: at('2026-06-15T11:00') })
    expect(uv).toMatchObject({ kind: 'forecast', peakUV: 6.5, avgUV: 5.5 })
  })
})

describe('sunscreen and burn', () => {
  const start = at('2026-06-20T09:00')

  it('advises sunscreen from UV 3, with reapplication every two hours', () => {
    expect(sunscreenTiming(start, start + 5 * 3_600_000, 6)).toEqual({
      applyFrom: start - 30 * 60_000,
      applyBy: start - 15 * 60_000,
      reapplyAt: [start + 2 * 3_600_000, start + 4 * 3_600_000],
    })
    expect(sunscreenTiming(start, start + 3_600_000, 2.4)).toBeNull()
    // 2.5 rounds to the Moderate band, where protection starts.
    expect(sunscreenTiming(start, start + 3_600_000, 2.5)).not.toBeNull()
  })

  it('estimates the time to burn at the peak for the skin type', () => {
    const uv = {
      kind: 'forecast',
      peakUV: 7.5,
      avgUV: 5,
      peakAt: start,
      forecastPeakUV: 7.5,
    } as const
    expect(eventBurn(uv, start, start + 90 * 60_000, 'fair')).toEqual({
      minutes: 20,
      outlasts: true,
    })
    expect(eventBurn(uv, start, start + 15 * 60_000, 'fair')).toEqual({
      minutes: 20,
      outlasts: false,
    })
    expect(eventBurn({ ...uv, peakUV: 0.2 }, start, start + 90 * 60_000, 'fair')).toEqual({
      minutes: null,
      outlasts: false,
    })
  })
})

describe('hostile input', () => {
  it('stays fast on a rule that would run for decades', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART:19000101T090000Z',
      'RRULE:FREQ=DAILY;COUNT=999999',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const started = performance.now()
    parseIcs(text, { now: Date.parse('2026-06-15T17:30:00Z'), defaultTimeZone: LA })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
