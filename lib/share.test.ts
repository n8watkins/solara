import { describe, expect, it } from 'vitest'
import {
  buildActivityShareText,
  buildActivityShareUrl,
  formatShareDate,
  isIsoDate,
  localIsoDate,
  parseActivityShareParams,
  sanitizeShareText,
  SHARE_LIMITS,
  shareDateStatus,
} from './share'
import type { Activity, Location } from './types'

const run: Activity = {
  id: 'run',
  name: 'Run',
  icon: '🏃',
  durationMins: 60,
  maxUV: 3,
  sunscreen: false,
}
const pasadena: Location = { lat: 34.15, lon: -118.14, city: 'Pasadena', region: 'California' }

function parse(query: string) {
  return parseActivityShareParams(new URLSearchParams(query))
}

const VALID = 'a=Run&city=Pasadena&date=2026-06-15&from=7.5&to=8.5'

describe('shared activity parameters', () => {
  it('rejects incomplete and invalid shared plans', () => {
    expect(parseActivityShareParams(new URLSearchParams())).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&to=1')).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&from=&to=1')).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&from=8&to=8')).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&from=-1&to=1')).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&from=23&to=25')).toBeNull()
    expect(parse('a=Run&city=Pasadena&date=2026-06-15&from=1e1&to=12')).toBeNull()
  })

  it('requires an ISO calendar date, so relative labels cannot go stale', () => {
    expect(parse(VALID)).not.toBeNull()
    expect(parse(VALID.replace('2026-06-15', 'Today'))).toBeNull()
    expect(parse(VALID.replace('2026-06-15', '2026-02-30'))).toBeNull()
    expect(parse(VALID.replace('2026-06-15', '2026-6-15'))).toBeNull()
  })

  it('parses a complete shared plan', () => {
    expect(
      parse(
        'a=Run&icon=%F0%9F%8F%83&city=Pasadena&region=California&date=2026-06-15&from=7.5&to=8.5&uv=2.1',
      ),
    ).toEqual({
      activity: 'Run',
      icon: '🏃',
      city: 'Pasadena',
      region: 'California',
      date: '2026-06-15',
      from: 7.5,
      to: 8.5,
      uv: '2.1',
    })
  })

  it('accepts real place and activity names', () => {
    expect(parse(`${VALID}&region=Île-de-France`.replace('Pasadena', "St. John's"))).toMatchObject({
      city: "St. John's",
      region: 'Île-de-France',
    })
    expect(parse(VALID.replace('a=Run', 'a=5k run %26 stretch'))).toMatchObject({
      activity: '5k run & stretch',
    })
  })

  it('rejects text that could turn the page into a phishing lure', () => {
    for (const activity of [
      'Your account is locked visit evil.example.com',
      'Login at https://evil.example',
      'Email support@evil.example',
      'Call 555 123 4567 now',
      'Run‮moc.live',
      'Run\u0000',
      'x'.repeat(SHARE_LIMITS.activity + 1),
    ]) {
      expect(parse(`${VALID.replace('a=Run', `a=${encodeURIComponent(activity)}`)}`)).toBeNull()
    }
    expect(parse(`${VALID}&region=${'r'.repeat(SHARE_LIMITS.place + 1)}`)).toBeNull()
  })

  it('falls back to the default icon for anything but a single emoji', () => {
    expect(parse(`${VALID}&icon=Click%20here`)?.icon).toBe('☀️')
    expect(parse(`${VALID}&icon=%F0%9F%8F%83%F0%9F%8F%83`)?.icon).toBe('☀️')
    expect(parse(`${VALID}&icon=%F0%9F%8F%84%E2%80%8D%E2%99%80%EF%B8%8F`)?.icon).toBe('🏄‍♀️')
  })

  it('drops malformed UV values', () => {
    expect(parse(`${VALID}&uv=2.1`)?.uv).toBe('2.1')
    expect(parse(`${VALID}&uv=99`)?.uv).toBeUndefined()
    expect(parse(`${VALID}&uv=high`)?.uv).toBeUndefined()
  })
})

describe('share dates', () => {
  const now = new Date(2026, 5, 15, 10, 30)

  it('validates and builds local ISO dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(localIsoDate(0, now)).toBe('2026-06-15')
    expect(localIsoDate(17, now)).toBe('2026-07-02')
  })

  it('labels dates relative to the viewer and flags past plans', () => {
    expect(formatShareDate('2026-06-15', now)).toBe('Today')
    expect(formatShareDate('2026-06-16', now)).toBe('Tomorrow')
    expect(formatShareDate('2026-06-17', now)).toBe('Wed, Jun 17')
    expect(formatShareDate('2027-01-04', now)).toBe('Mon, Jan 4, 2027')
    expect(shareDateStatus('2026-06-14', now)).toBe('past')
    expect(shareDateStatus('2026-06-15', now)).toBe('today')
    expect(shareDateStatus('2026-06-16', now)).toBe('future')
  })
})

describe('building share links', () => {
  it('uses the share route, an ISO date and round-trips through the parser', () => {
    const url = new URL(
      buildActivityShareUrl(
        {
          activity: run,
          window: { from: 7.5, to: 8.5, peakUV: 2.14 },
          location: pasadena,
          dateLabel: 'Wed, Jun 17',
          isoDate: '2026-06-17',
        },
        'https://example.test',
      ),
    )
    expect(url.pathname).toBe('/share/')
    expect(url.searchParams.get('date')).toBe('2026-06-17')
    expect(url.searchParams.has('day')).toBe(false)
    expect(parseActivityShareParams(url.searchParams)).toEqual({
      activity: 'Run',
      icon: '🏃',
      city: 'Pasadena',
      region: 'California',
      date: '2026-06-17',
      from: 7.5,
      to: 8.5,
      uv: '2.1',
    })
  })

  it('derives the date from the day offset when no ISO date is given', () => {
    const url = new URL(
      buildActivityShareUrl({
        activity: run,
        window: { from: 7, to: 8 },
        location: pasadena,
        dateLabel: 'Tomorrow',
        dayOffset: 1,
      }),
    )
    expect(url.searchParams.get('date')).toBe(localIsoDate(1))
  })

  it('sanitizes sender text so its own links always parse', () => {
    const url = new URL(
      buildActivityShareUrl({
        activity: { ...run, name: 'Run/walk: intervals', icon: 'not an emoji' },
        window: { from: 7, to: 8 },
        location: { ...pasadena, city: 'Visit evil.example.com', region: '' },
        dateLabel: 'Today',
      }),
    )
    expect(parseActivityShareParams(url.searchParams)).toMatchObject({
      activity: 'Run walk intervals',
      icon: '☀️',
      city: 'Shared location',
      region: '',
    })
  })

  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeShareText('  Run ‮\u0007  fast  ', 60)).toBe('Run fast')
    expect(sanitizeShareText('abcdef', 3)).toBe('abc')
  })

  it('formats fractional shared windows as clock times', () => {
    expect(
      buildActivityShareText(
        {
          activity: run,
          window: { from: 7.5, to: 8.5 },
          location: pasadena,
          dateLabel: 'Today',
        },
        '12h',
      ),
    ).toContain('from 7:30am to 8:30am')
  })

  it("writes shared windows in the sender's clock format", () => {
    expect(
      buildActivityShareText(
        { activity: run, window: { from: 7.5, to: 18 }, location: pasadena, dateLabel: 'Today' },
        '24h',
      ),
    ).toContain('from 07:30 to 18:00 in Pasadena')
  })
})
