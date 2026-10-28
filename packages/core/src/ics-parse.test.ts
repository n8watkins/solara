import { describe, expect, it } from 'vitest'
import { buildICS } from './ics'
import {
  ICS_IMPORT_LIMITS,
  IcsImportError,
  parseContentLine,
  parseDuration,
  parseIcs,
  parseTimeValue,
  safeEventUrl,
  stripInvisibleFormatting,
  unescapeText,
  unfoldLines,
} from './ics-parse'

// "Now" for every test: Monday 2026-06-15, 10:30 in Los Angeles.
const NOW = Date.parse('2026-06-15T17:30:00Z')
const LA = 'America/Los_Angeles'

function calendar(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...lines, 'END:VCALENDAR'].join(
    '\r\n',
  )
}

function vevent(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
}

const parse = (text: string, defaultTimeZone = LA) => parseIcs(text, { now: NOW, defaultTimeZone })
const iso = (ms: number) => new Date(ms).toISOString()

describe('content lines', () => {
  it('unfolds continuation lines (space or tab) and drops blank lines', () => {
    expect(unfoldLines('SUMMARY:Sat\r\n urday\r\n\tparkrun\n\nUID:1\rEND:X')).toEqual([
      'SUMMARY:Saturdayparkrun',
      'UID:1',
      'END:X',
    ])
  })

  it('reads parameters, quoted values and colons in the value', () => {
    expect(
      parseContentLine('DTSTART;TZID="America/New_York";VALUE=DATE-TIME:20260620T080000'),
    ).toEqual({
      name: 'DTSTART',
      params: new Map([
        ['TZID', 'America/New_York'],
        ['VALUE', 'DATE-TIME'],
      ]),
      value: '20260620T080000',
    })
    expect(parseContentLine('URL:https://example.com/a?b=c:d')?.value).toBe(
      'https://example.com/a?b=c:d',
    )
    expect(parseContentLine('X-PARAM;A="x;y:z",w:v')?.params.get('A')).toBe('x;y:z,w')
    expect(parseContentLine('summary:lower')?.name).toBe('SUMMARY')
  })

  it.each(['no colon here', ':value', 'NAME;broken', 'NAME;P="unterminated:x', 'NA ME:x'])(
    'rejects malformed line %j',
    line => {
      expect(parseContentLine(line)).toBeNull()
    },
  )

  it('unescapes TEXT values', () => {
    expect(unescapeText('a\\, b\\; c\\\\d\\ne\\Nf')).toBe('a, b; c\\d\ne\nf')
  })
})

describe('values', () => {
  it('reads dates and date-times, with or without seconds and Z', () => {
    expect(parseTimeValue('20260620')).toEqual({ kind: 'date', year: 2026, month: 6, day: 20 })
    expect(parseTimeValue('20260620T0830')).toMatchObject({
      kind: 'datetime',
      local: { hour: 8, minute: 30, second: 0 },
      utc: false,
    })
    expect(parseTimeValue('20260620T083060Z')).toMatchObject({ local: { second: 59 }, utc: true })
  })

  it.each(['20260231', '20261301', '20260620T250000', '20260620T086000', '2026-06-20', ''])(
    'rejects %j',
    raw => {
      expect(parseTimeValue(raw)).toBeNull()
    },
  )

  it('reads durations', () => {
    expect(parseDuration('PT1H30M')).toBe(90 * 60_000)
    expect(parseDuration('P1DT2H')).toBe(26 * 3_600_000)
    expect(parseDuration('P2W')).toBe(14 * 86_400_000)
    expect(parseDuration('-PT15M')).toBe(-15 * 60_000)
    expect(parseDuration('P')).toBeNull()
    expect(parseDuration('PT')).toBeNull()
    expect(parseDuration('1H')).toBeNull()
  })

  it('keeps https links only', () => {
    expect(safeEventUrl(' https://www.meetup.com/x/events/1/ ')).toBe(
      'https://www.meetup.com/x/events/1/',
    )
    expect(safeEventUrl('http://example.com')).toBeNull()
    expect(safeEventUrl('javascript:alert(1)')).toBeNull()
    expect(safeEventUrl('data:text/html,hi')).toBeNull()
    expect(safeEventUrl('not a url')).toBeNull()
    expect(safeEventUrl(`https://example.com/${'x'.repeat(2048)}`)).toBeNull()
  })
})

describe('parseIcs', () => {
  it('reads a simple event with its place and link', () => {
    const result = parse(
      calendar(
        'X-WR-CALNAME:Run club',
        ...vevent(
          'UID:abc@example.com',
          'DTSTART;TZID=America/Los_Angeles:20260620T080000',
          'DTEND;TZID=America/Los_Angeles:20260620T093000',
          'SUMMARY:Saturday 10K\\, Griffith Park',
          'LOCATION:Griffith Park\\, Los Angeles\\, CA',
          'GEO:34.1366;-118.2942',
          'URL:https://example.com/run',
          'DESCRIPTION:Not stored',
        ),
      ),
    )
    expect(result.calendarName).toBe('Run club')
    expect(result.events).toEqual([
      {
        uid: 'abc@example.com',
        recurrenceId: null,
        title: 'Saturday 10K, Griffith Park',
        start: Date.parse('2026-06-20T15:00:00Z'),
        end: Date.parse('2026-06-20T16:30:00Z'),
        timeZone: LA,
        location: 'Griffith Park, Los Angeles, CA',
        geo: { lat: 34.1366, lon: -118.2942 },
        url: 'https://example.com/run',
      },
    ])
  })

  it('reads UTC, floating and TZID times', () => {
    const { events } = parse(
      calendar(
        ...vevent('UID:utc', 'DTSTART:20260620T150000Z', 'DTEND:20260620T160000Z'),
        // Floating: read in the default zone (the person's place).
        ...vevent('UID:floating', 'DTSTART:20260621T080000', 'DTEND:20260621T090000'),
        ...vevent(
          'UID:tokyo',
          'DTSTART;TZID=Asia/Tokyo:20260622T080000',
          'DTEND;TZID=Asia/Tokyo:20260622T090000',
        ),
      ),
    )
    const byUid = Object.fromEntries(events.map(e => [e.uid, e]))
    expect(iso(byUid.utc!.start)).toBe('2026-06-20T15:00:00.000Z')
    expect(byUid.utc!.timeZone).toBe('UTC')
    expect(iso(byUid.floating!.start)).toBe('2026-06-21T15:00:00.000Z')
    expect(byUid.floating!.timeZone).toBe(LA)
    expect(iso(byUid.tokyo!.start)).toBe('2026-06-21T23:00:00.000Z')
  })

  it('resolves Windows zone names, Mozilla-style paths and X-LIC-LOCATION', () => {
    const { events, unknownTimeZone } = parse(
      calendar(
        'BEGIN:VTIMEZONE',
        'TZID:Custom Paris',
        'X-LIC-LOCATION:Europe/Paris',
        'END:VTIMEZONE',
        ...vevent('UID:win', 'DTSTART;TZID=Eastern Standard Time:20260620T080000'),
        ...vevent('UID:moz', 'DTSTART;TZID=/mozilla.org/20050126_1/Europe/London:20260620T080000'),
        ...vevent('UID:lic', 'DTSTART;TZID=Custom Paris:20260620T080000'),
      ),
    )
    const byUid = Object.fromEntries(events.map(e => [e.uid, e]))
    expect(iso(byUid.win!.start)).toBe('2026-06-20T12:00:00.000Z')
    expect(byUid.win!.timeZone).toBe('America/New_York')
    expect(iso(byUid.moz!.start)).toBe('2026-06-20T07:00:00.000Z')
    expect(iso(byUid.lic!.start)).toBe('2026-06-20T06:00:00.000Z')
    expect(unknownTimeZone).toBe(0)
  })

  it('evaluates a VTIMEZONE definition with daylight-saving rules', () => {
    const vtimezone = [
      'BEGIN:VTIMEZONE',
      'TZID:Outlook Zone',
      'BEGIN:STANDARD',
      'DTSTART:16011104T020000',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010311T020000',
      'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
    ]
    const { events } = parse(
      calendar(
        ...vtimezone,
        ...vevent('UID:summer', 'DTSTART;TZID=Outlook Zone:20260620T080000'),
        ...vevent('UID:winter', 'DTSTART;TZID=Outlook Zone:20261210T080000'),
      ),
    )
    const byUid = Object.fromEntries(events.map(e => [e.uid, e]))
    expect(iso(byUid.summer!.start)).toBe('2026-06-20T12:00:00.000Z')
    expect(iso(byUid.winter!.start)).toBe('2026-12-10T13:00:00.000Z')
  })

  it('reads an unknown TZID in the default zone and says so', () => {
    const { events, unknownTimeZone } = parse(
      calendar(...vevent('UID:x', 'DTSTART;TZID=Nowhere/Special:20260620T080000')),
    )
    expect(iso(events[0]!.start)).toBe('2026-06-20T15:00:00.000Z')
    expect(unknownTimeZone).toBe(1)
  })

  it('takes DURATION, and an hour when neither DTEND nor DURATION is given', () => {
    const { events } = parse(
      calendar(
        ...vevent('UID:d', 'DTSTART:20260620T150000Z', 'DURATION:PT2H30M'),
        ...vevent('UID:n', 'DTSTART:20260621T150000Z'),
        ...vevent('UID:z', 'DTSTART:20260622T150000Z', 'DTEND:20260622T150000Z'),
      ),
    )
    expect(events.map(e => (e.end - e.start) / 60_000)).toEqual([150, 60, 60])
  })

  it('skips all-day, cancelled, past, far-off, too-long and invalid events', () => {
    const result = parse(
      calendar(
        ...vevent('UID:allday', 'DTSTART;VALUE=DATE:20260620', 'DTEND;VALUE=DATE:20260621'),
        ...vevent('UID:allday2', 'DTSTART:20260620'),
        ...vevent('UID:cancel', 'DTSTART:20260620T150000Z', 'STATUS:CANCELLED'),
        ...vevent('UID:past', 'DTSTART:20260614T150000Z', 'DTEND:20260614T160000Z'),
        ...vevent('UID:far', 'DTSTART:20280101T150000Z'),
        ...vevent('UID:long', 'DTSTART:20260620T150000Z', 'DURATION:P8D'),
        ...vevent('UID:bad', 'DTSTART:20260620T999999Z'),
        ...vevent('UID:nostart', 'SUMMARY:No start'),
        ...vevent('UID:backwards', 'DTSTART:20260620T150000Z', 'DTEND:20260620T140000Z'),
        ...vevent('UID:mixed', 'DTSTART:20260620T150000Z', 'DTEND;VALUE=DATE:20260621'),
        ...vevent('UID:ok', 'DTSTART:20260620T150000Z'),
      ),
    )
    expect(result.events.map(e => e.uid)).toEqual(['ok'])
    expect(result.skipped).toEqual({
      allDay: 2,
      cancelled: 1,
      past: 1,
      tooFar: 1,
      tooLong: 1,
      invalid: 4,
      overLimit: 0,
    })
  })

  it('keeps an event that is under way', () => {
    const { events } = parse(
      calendar(...vevent('UID:now', 'DTSTART:20260615T170000Z', 'DTEND:20260615T180000Z')),
    )
    expect(events).toHaveLength(1)
  })

  it('expands a weekly rule over the forecast range only, in the event zone', () => {
    const { events } = parse(
      calendar(
        ...vevent(
          'UID:club',
          'DTSTART;TZID=America/Los_Angeles:20260101T070000',
          'DTEND;TZID=America/Los_Angeles:20260101T080000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU,SA',
          'SUMMARY:Club run',
        ),
      ),
    )
    // Within ten days of Monday 2026-06-15: Tue 16, Sat 20, Tue 23 (Jan 1 was in winter
    // time; June occurrences stay at 7am local, in daylight time).
    expect(events.map(e => iso(e.start))).toEqual([
      '2026-06-16T14:00:00.000Z',
      '2026-06-20T14:00:00.000Z',
      '2026-06-23T14:00:00.000Z',
    ])
    expect(events.map(e => e.recurrenceId)).toEqual(events.map(e => iso(e.start)))
    expect(new Set(events.map(e => e.uid))).toEqual(new Set(['club']))
  })

  it('applies EXDATE, RDATE and RECURRENCE-ID overrides', () => {
    const { events } = parse(
      calendar(
        ...vevent(
          'UID:s',
          'DTSTART;TZID=America/Los_Angeles:20260615T180000',
          'DURATION:PT1H',
          'RRULE:FREQ=DAILY;COUNT=10',
          'EXDATE;TZID=America/Los_Angeles:20260616T180000,20260617T180000',
          'EXDATE;VALUE=DATE:20260618',
          'RDATE;TZID=America/Los_Angeles:20260616T070000',
          'SUMMARY:Evening ride',
          'LOCATION:Santa Monica',
        ),
        // Moved and renamed.
        ...vevent(
          'UID:s',
          'RECURRENCE-ID;TZID=America/Los_Angeles:20260619T180000',
          'DTSTART;TZID=America/Los_Angeles:20260619T190000',
          'DTEND;TZID=America/Los_Angeles:20260619T203000',
          'SUMMARY:Evening ride (late start)',
        ),
        // Cancelled.
        ...vevent(
          'UID:s',
          'RECURRENCE-ID;TZID=America/Los_Angeles:20260620T180000',
          'DTSTART;TZID=America/Los_Angeles:20260620T180000',
          'STATUS:CANCELLED',
        ),
      ),
    )
    const shown = events.map(e => [iso(e.start), e.title, e.location, (e.end - e.start) / 60_000])
    expect(shown).toEqual([
      ['2026-06-16T01:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
      ['2026-06-16T14:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
      ['2026-06-20T02:00:00.000Z', 'Evening ride (late start)', 'Santa Monica', 90],
      ['2026-06-22T01:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
      ['2026-06-23T01:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
      ['2026-06-24T01:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
      ['2026-06-25T01:00:00.000Z', 'Evening ride', 'Santa Monica', 60],
    ])
    // The moved occurrence keeps its original start as its id.
    expect(events[2]!.recurrenceId).toBe('2026-06-20T01:00:00.000Z')
  })

  it('stops a rule at UNTIL', () => {
    const { events } = parse(
      calendar(
        ...vevent('UID:u', 'DTSTART:20260615T200000Z', 'RRULE:FREQ=DAILY;UNTIL=20260617T200000Z'),
      ),
    )
    expect(events.map(e => iso(e.start))).toEqual([
      '2026-06-15T20:00:00.000Z',
      '2026-06-16T20:00:00.000Z',
      '2026-06-17T20:00:00.000Z',
    ])
  })

  it('shows the next occurrence of a series that starts after the forecast range', () => {
    const { events } = parse(
      calendar(...vevent('UID:later', 'DTSTART:20260801T150000Z', 'RRULE:FREQ=WEEKLY')),
    )
    expect(events.map(e => iso(e.start))).toEqual(['2026-08-01T15:00:00.000Z'])
  })

  it('caps the occurrences of one series', () => {
    const { events } = parse(
      calendar(
        ...vevent(
          'UID:many',
          'DTSTART:20260615T180000Z',
          'DURATION:PT30M',
          'RRULE:FREQ=DAILY;BYMONTH=6,7',
        ),
      ),
    )
    expect(events.length).toBeLessThanOrEqual(ICS_IMPORT_LIMITS.maxOccurrencesPerSeries)
    expect(events).toHaveLength(10)
  })

  it('reads only the first date of a rule it cannot expand', () => {
    const result = parse(
      calendar(...vevent('UID:hourly', 'DTSTART:20260620T150000Z', 'RRULE:FREQ=HOURLY;COUNT=5')),
    )
    expect(result.events).toHaveLength(1)
    expect(result.unsupportedRecurrence).toBe(1)
  })

  it('keeps an override whose series is not in the file', () => {
    const { events } = parse(
      calendar(
        ...vevent('UID:orphan', 'RECURRENCE-ID:20260620T150000Z', 'DTSTART:20260620T160000Z'),
      ),
    )
    expect(events.map(e => [e.uid, e.recurrenceId])).toEqual([
      ['orphan', '2026-06-20T15:00:00.000Z'],
    ])
  })

  it('gives an event without a UID a stable stand-in', () => {
    const text = calendar(...vevent('DTSTART:20260620T150000Z', 'SUMMARY:Picnic'))
    expect(parse(text).events[0]!.uid).toBe(parse(text).events[0]!.uid)
    expect(parse(text).events[0]!.uid).toContain('Picnic')
  })

  it('cleans titles and places and caps their length', () => {
    const { events } = parse(
      calendar(
        ...vevent(
          'UID:t',
          'DTSTART:20260620T150000Z',
          `SUMMARY:  Line one\\nline\u0007two ${'🏃'.repeat(150)}`,
          'LOCATION:   ',
        ),
      ),
    )
    expect(events[0]!.title.startsWith('Line one line two 🏃')).toBe(true)
    expect(events[0]!.title.length).toBeLessThanOrEqual(ICS_IMPORT_LIMITS.titleLength)
    expect(events[0]!.title.endsWith('\ud83c')).toBe(false)
    expect(events[0]!.location).toBeNull()
  })

  it('ignores bad GEO values and non-https links', () => {
    const { events } = parse(
      calendar(
        ...vevent('UID:g', 'DTSTART:20260620T150000Z', 'GEO:95;10', 'URL:javascript:alert(1)'),
      ),
    )
    expect(events[0]).toMatchObject({ geo: null, url: null })
  })

  it('ignores alarms and other nested components', () => {
    const { events } = parse(
      calendar(
        ...vevent(
          'UID:a',
          'DTSTART:20260620T150000Z',
          'SUMMARY:Hike',
          'BEGIN:VALARM',
          'TRIGGER:-PT15M',
          'SUMMARY:Alarm text',
          'DESCRIPTION:Reminder',
          'END:VALARM',
        ),
      ),
    )
    expect(events[0]!.title).toBe('Hike')
  })

  it('survives malformed structure: stray ENDs, garbage lines and a truncated file', () => {
    const text = [
      '﻿BEGIN:VCALENDAR',
      'END:VEVENT',
      'this is not a content line',
      ...vevent('UID:ok', 'DTSTART:20260620T150000Z', 'SUMMARY:Fine'),
      'BEGIN:VEVENT',
      'UID:cut',
      'DTSTART:20260621T150000Z',
    ].join('\n')
    const { events } = parse(text)
    expect(events.map(e => e.uid)).toEqual(['ok', 'cut'])
  })

  it('rejects text that is not a calendar', () => {
    expect(() => parse('hello world')).toThrow(IcsImportError)
    expect(() => parse('<html><body>Not found</body></html>')).toThrow(
      expect.objectContaining({ code: 'not-calendar' }),
    )
  })

  it('rejects a file over the size cap', () => {
    const big = calendar(`X-PAD:${'x'.repeat(ICS_IMPORT_LIMITS.maxBytes)}`)
    expect(() => parse(big)).toThrow(expect.objectContaining({ code: 'too-large' }))
  })

  it('keeps the soonest events up to the cap', () => {
    const lines: string[] = []
    for (let i = 0; i < ICS_IMPORT_LIMITS.maxEvents + 25; i += 1) {
      const start = new Date(NOW + (i + 1) * 3_600_000).toISOString().replace(/[-:]|\.\d+/g, '')
      lines.push(...vevent(`UID:e${i}`, `DTSTART:${start}`))
    }
    const result = parse(calendar(...lines.reverse().join('\n').split('\n').reverse()))
    expect(result.events).toHaveLength(ICS_IMPORT_LIMITS.maxEvents)
    expect(result.events[0]!.uid).toBe('e0')
    expect(result.skipped.overLimit).toBe(25)
  })

  it('reads Solara’s own export back (floating times in the default zone)', () => {
    const text = buildICS(
      [
        {
          uid: '2026-06-16-run-420@solara',
          summary: '🏃 Running: lower-UV window',
          description: 'Plan, with a comma, and; a semicolon',
          dateStr: '2026-06-16',
          start: 7,
          end: 7.75,
        },
      ],
      new Date(NOW),
    )
    const { events } = parse(text)
    expect(events).toEqual([
      expect.objectContaining({
        uid: '2026-06-16-run-420@solara',
        title: '🏃 Running: lower-UV window',
        start: Date.parse('2026-06-16T14:00:00Z'),
        end: Date.parse('2026-06-16T14:45:00Z'),
      }),
    ])
  })
})

describe('re-import information', () => {
  it('lists cancelled events and occurrences', () => {
    const result = parse(
      calendar(
        ...vevent('UID:race', 'DTSTART:20260620T150000Z', 'STATUS:CANCELLED'),
        ...vevent('UID:ride', 'DTSTART:20260615T200000Z', 'RRULE:FREQ=DAILY;COUNT=5'),
        ...vevent(
          'UID:ride',
          'RECURRENCE-ID:20260617T200000Z',
          'DTSTART:20260617T200000Z',
          'STATUS:CANCELLED',
        ),
        ...vevent(
          'UID:orphan',
          'RECURRENCE-ID:20260618T150000Z',
          'DTSTART:20260618T150000Z',
          'STATUS:cancelled',
        ),
      ),
    )
    expect(result.cancelled).toEqual([
      { uid: 'race', recurrenceId: null },
      { uid: 'ride', recurrenceId: '2026-06-17T20:00:00.000Z' },
      { uid: 'orphan', recurrenceId: '2026-06-18T15:00:00.000Z' },
    ])
    expect(result.skipped.cancelled).toBe(2)
  })

  it('says how far each recurring event was read in full', () => {
    const result = parse(
      calendar(
        // Ends within the range: read to its end.
        ...vevent('UID:short', 'DTSTART:20260615T200000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
        // Goes on past the range: read up to its next occurrence after it.
        ...vevent('UID:weekly', 'DTSTART:20260601T200000Z', 'RRULE:FREQ=WEEKLY'),
        // A one-off event is not a series.
        ...vevent('UID:once', 'DTSTART:20260620T150000Z'),
        // A rule that cannot be expanded is not read in full.
        ...vevent('UID:hourly', 'DTSTART:20260620T150000Z', 'RRULE:FREQ=HOURLY'),
      ),
    )
    expect(result.series).toEqual([
      { uid: 'short', until: null },
      { uid: 'weekly', until: Date.parse('2026-06-29T20:00:00Z') },
    ])
  })

  it('reads a series with an occurrence cap only up to the cap', () => {
    const result = parse(
      calendar(...vevent('UID:many', 'DTSTART:20260615T180000Z', 'RRULE:FREQ=DAILY;BYMONTH=6,7')),
    )
    expect(result.events).toHaveLength(10)
    expect(result.series).toEqual([{ uid: 'many', until: Date.parse('2026-06-25T18:00:00Z') }])
  })
})

describe('hostile input', () => {
  /** Milliseconds one parse takes. */
  function timed(text: string) {
    const started = performance.now()
    const result = parse(text)
    return { result, ms: performance.now() - started }
  }

  /** As many copies of a component as fit in the size cap. */
  function filled(component: (i: number) => string, reserve = 0): string {
    const parts: string[] = []
    let size = 200 + reserve
    for (let i = 0; ; i += 1) {
      const next = component(i)
      if (size + next.length > ICS_IMPORT_LIMITS.maxBytes) break
      parts.push(next)
      size += next.length + 2
    }
    return calendar(...parts)
  }

  // REVIEW4 M2: each of these took seconds to hours before the work allowance.
  it('bounds recurrence expansion that starts centuries ago', () => {
    const { result, ms } = timed(
      filled(i =>
        vevent(
          `UID:y${i}`,
          'DTSTART;TZID=America/New_York:10000101T090000',
          'DURATION:PT1H',
          'RRULE:FREQ=YEARLY;COUNT=999999;BYDAY=MO,TU,WE,TH,FR,SA,SU',
          'SUMMARY:x',
        ).join('\r\n'),
      ),
    )
    expect(ms).toBeLessThan(3000)
    expect(result.tooComplex).toBe(ICS_IMPORT_LIMITS.maxComponents)
    expect(result.series).toEqual([])
  })

  it('bounds rules that never match and huge date lists', () => {
    const never = timed(
      filled(i =>
        vevent(
          `UID:n${i}`,
          'DTSTART:20260101T090000Z',
          'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
        ).join('\r\n'),
      ),
    )
    expect(never.ms).toBeLessThan(3000)
    const dates = Array.from(
      { length: 60_000 },
      (_, i) => `2026${String(1 + (i % 12)).padStart(2, '0')}01T090000`,
    )
    const listed = timed(
      calendar(
        ...vevent(
          'UID:e',
          'DTSTART;TZID=Europe/Paris:20260101T090000',
          'RRULE:FREQ=DAILY',
          `EXDATE;TZID=Europe/Paris:${dates.join(',')}`,
        ),
      ).slice(0, ICS_IMPORT_LIMITS.maxBytes - 20),
    )
    expect(listed.ms).toBeLessThan(3000)
  })

  it('bounds a VTIMEZONE with a hostile rule and date list', () => {
    const rdates = Array.from({ length: 5000 }, (_, i) => `${1100 + (i % 800)}0101T020000`)
    const zone = [
      'BEGIN:VTIMEZONE',
      'TZID:Bad',
      'BEGIN:STANDARD',
      'DTSTART:10000101T020000',
      'RRULE:FREQ=YEARLY;COUNT=999999;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      `RDATE:${rdates.join(',')}`,
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
    ].join('\r\n')
    const events = filled(
      i => vevent(`UID:t${i}`, 'DTSTART;TZID=Bad:20260620T090000').join('\r\n'),
      zone.length + 2,
    )
    const { result, ms } = timed(
      events.replace('PRODID:-//Test//EN', `PRODID:-//Test//EN\r\n${zone}`),
    )
    expect(ms).toBeLessThan(3000)
    expect(result.events).toHaveLength(ICS_IMPORT_LIMITS.maxEvents)
  })

  it('bounds deep nesting and unmatched ENDs', () => {
    const lines = ['BEGIN:VCALENDAR']
    for (let i = 0; i < 60_000; i += 1) lines.push('BEGIN:X')
    for (let i = 0; i < 60_000; i += 1) lines.push('END:Y')
    lines.push(...vevent('UID:inside', 'DTSTART:20260620T150000Z'), 'END:VCALENDAR')
    const { result, ms } = timed(lines.join('\r\n').slice(-ICS_IMPORT_LIMITS.maxBytes))
    expect(ms).toBeLessThan(1000)
    expect(result.events).toEqual([])
  })

  it('reads a series that starts long ago with COUNT without stepping every day', () => {
    const { result, ms } = timed(
      calendar(
        ...vevent(
          'UID:old',
          'DTSTART:15000101T090000Z',
          'DURATION:PT1H',
          'RRULE:FREQ=DAILY;COUNT=999999',
        ),
        ...vevent(
          'UID:weeks',
          'DTSTART:15000101T090000Z',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=99999',
        ),
      ),
    )
    expect(ms).toBeLessThan(500)
    expect(result.tooComplex).toBe(0)
    expect(result.events.filter(e => e.uid === 'old').map(e => iso(e.start))[0]).toBe(
      '2026-06-16T09:00:00.000Z',
    )
    expect(result.events.filter(e => e.uid === 'weeks').length).toBeGreaterThan(0)
  })
})

describe('invisible formatting', () => {
  it('removes bidirectional controls and zero-width spaces but keeps joiners', () => {
    expect(stripInvisibleFormatting('photo\u202egnp.exe\u202c')).toBe('photognp.exe')
    expect(stripInvisibleFormatting('a\u200bb\u2066c\u2069\u200fd\ufeff')).toBe('abcd')
    // A family emoji is joined with U+200D.
    expect(stripInvisibleFormatting('👨\u200d👩\u200d👧')).toBe('👨\u200d👩\u200d👧')
  })

  it('is applied to titles, places and the calendar name', () => {
    const result = parse(
      calendar(
        'X-WR-CALNAME:Club \u202ecal',
        ...vevent(
          'UID:b',
          'DTSTART:20260620T150000Z',
          'SUMMARY:Beach volleyball \u202egnp.exe\u202c',
          'LOCATION:Venice\u2067 Beach',
        ),
      ),
    )
    expect(result.events[0]).toMatchObject({
      title: 'Beach volleyball gnp.exe',
      location: 'Venice Beach',
    })
    expect(result.calendarName).toBe('Club cal')
  })
})
