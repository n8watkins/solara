import { describe, expect, it } from 'vitest'
import { ExpansionBudget, expandRrule, parseRrule, type Rrule } from './rrule'
import { civilDay, isoDateOf, type LocalDateTime } from './zoned-time'

const at = (iso: string): LocalDateTime => {
  const [date, time = '00:00'] = iso.split('T')
  const [year, month, day] = date!.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: 0 }
}

const rule = (value: string): Rrule => {
  const parsed = parseRrule(value, raw => ({
    local: at(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T23:59`),
  }))
  if (!parsed) throw new Error(`unsupported: ${value}`)
  return parsed
}

/** The first `n` dates (YYYY-MM-DD) of a rule from `start`. */
function dates(value: string, start: string, n = 10, fromDay?: number): string[] {
  const out: string[] = []
  for (const local of expandRrule(rule(value), at(start), { fromDay })) {
    out.push(isoDateOf(local))
    if (out.length >= n) break
  }
  return out
}

describe('parseRrule', () => {
  it('reads the supported parts', () => {
    expect(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU;COUNT=6')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      count: 6,
      until: null,
      byDay: [
        { weekday: 1, ordinal: 0 },
        { weekday: 3, ordinal: 0 },
      ],
      byMonthDay: [],
      byMonth: [],
      bySetPos: [],
      weekStart: 0,
    })
  })

  it('is case-insensitive and ignores empty parts', () => {
    expect(rule('freq=daily;;interval=3').interval).toBe(3)
  })

  it.each([
    'FREQ=HOURLY',
    'FREQ=MINUTELY',
    'INTERVAL=2',
    'FREQ=DAILY;BYHOUR=9',
    'FREQ=YEARLY;BYWEEKNO=20',
    'FREQ=YEARLY;BYYEARDAY=100',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;COUNT=0',
    'FREQ=DAILY;COUNT=2;UNTIL=20260101',
    'FREQ=WEEKLY;BYDAY=2MO',
    'FREQ=MONTHLY;BYDAY=XX',
    'FREQ=MONTHLY;BYMONTHDAY=0',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=YEARLY;BYMONTH=13',
    'FREQ=DAILY;FREQ=WEEKLY',
    'FREQ=DAILY;WKST=XX',
    'garbage',
  ])('rejects %s', value => {
    expect(parseRrule(value, () => null)).toBeNull()
  })

  it('rejects an UNTIL the caller cannot read', () => {
    expect(parseRrule('FREQ=DAILY;UNTIL=nonsense', () => null)).toBeNull()
  })
})

describe('expandRrule', () => {
  it('repeats daily with an interval and a count', () => {
    expect(dates('FREQ=DAILY;INTERVAL=2;COUNT=3', '2026-06-14T09:00')).toEqual([
      '2026-06-14',
      '2026-06-16',
      '2026-06-18',
    ])
  })

  it('keeps the start time on every occurrence', () => {
    const [, second] = [...expandRrule(rule('FREQ=DAILY;COUNT=2'), at('2026-06-14T07:45'))]
    expect(second).toMatchObject({ day: 15, hour: 7, minute: 45 })
  })

  it('repeats weekly on several days, counting the start as the first', () => {
    // 2026-06-15 is a Monday.
    expect(dates('FREQ=WEEKLY;BYDAY=MO,WE,SA;COUNT=5', '2026-06-15T18:00')).toEqual([
      '2026-06-15',
      '2026-06-17',
      '2026-06-20',
      '2026-06-22',
      '2026-06-24',
    ])
  })

  it('honors WKST for a fortnightly rule', () => {
    // RFC 5545's own example: the week start decides which weeks count.
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO', '1997-08-05T09:00')).toEqual(
      ['1997-08-05', '1997-08-10', '1997-08-19', '1997-08-24'],
    )
    expect(dates('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU', '1997-08-05T09:00')).toEqual(
      ['1997-08-05', '1997-08-17', '1997-08-19', '1997-08-31'],
    )
  })

  it('takes the nth and last weekday of the month', () => {
    expect(dates('FREQ=MONTHLY;BYDAY=1SA;COUNT=3', '2026-06-06T08:00')).toEqual([
      '2026-06-06',
      '2026-07-04',
      '2026-08-01',
    ])
    expect(dates('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', '2026-06-26T08:00')).toEqual([
      '2026-06-26',
      '2026-07-31',
      '2026-08-28',
    ])
  })

  it('skips months without the start day', () => {
    expect(dates('FREQ=MONTHLY;COUNT=4', '2026-01-31T10:00')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ])
  })

  it('counts negative month days from the end', () => {
    expect(dates('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', '2026-01-31T10:00')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
  })

  it('combines BYDAY and BYMONTHDAY (Friday the 13th)', () => {
    expect(dates('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=3', '2026-02-13T10:00')).toEqual([
      '2026-02-13',
      '2026-03-13',
      '2026-11-13',
    ])
  })

  it('picks positions with BYSETPOS (last weekday of the month)', () => {
    expect(
      dates('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3', '2026-06-30T17:00'),
    ).toEqual(['2026-06-30', '2026-07-31', '2026-08-31'])
  })

  it('repeats yearly by month and weekday (US daylight saving rule)', () => {
    expect(dates('FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', '2007-03-11T02:00', 3)).toEqual([
      '2007-03-11',
      '2008-03-09',
      '2009-03-08',
    ])
  })

  it('repeats yearly by a weekday of the year', () => {
    expect(dates('FREQ=YEARLY;BYDAY=20MO;COUNT=3', '1997-05-19T09:00')).toEqual([
      '1997-05-19',
      '1998-05-18',
      '1999-05-17',
    ])
  })

  it('filters daily occurrences by month and weekday', () => {
    expect(dates('FREQ=DAILY;BYMONTH=7;BYDAY=SA,SU', '2026-06-27T09:00', 4)).toEqual([
      '2026-06-27',
      '2026-07-04',
      '2026-07-05',
      '2026-07-11',
    ])
  })

  it('stops at a local UNTIL, inclusive of that day', () => {
    expect(dates('FREQ=DAILY;UNTIL=20260617', '2026-06-14T09:00')).toEqual([
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
    ])
  })

  it('skips ahead to a later day when there is no COUNT', () => {
    const fromDay = civilDay(2026, 6, 15)
    // Six years of Saturdays are skipped; one period of slack is kept before the day.
    const result = dates('FREQ=WEEKLY;BYDAY=SA', '2020-01-04T09:00', 3, fromDay)
    expect(result).toEqual(['2026-06-06', '2026-06-13', '2026-06-20'])
  })

  it('counts from the start when a COUNT is set, whatever the hint', () => {
    const fromDay = civilDay(2026, 6, 15)
    // Every occurrence counts, so a short series ends long before the hint.
    expect(dates('FREQ=DAILY;COUNT=2', '2020-01-01T09:00', 5, fromDay)).toEqual(['2020-01-01'])
    // A series that runs past the hint ends on the same day whether its periods are
    // stepped one by one or skipped by multiplying.
    const daily = 'FREQ=DAILY;COUNT=2360'
    const all = dates(daily, '2020-01-01T09:00', 3000)
    expect(all.at(-1)).toBe('2026-06-17')
    const fast = dates(daily, '2020-01-01T09:00', 3000, fromDay).slice(1)
    expect(fast).toEqual(all.slice(all.length - fast.length))
    expect(fast).toEqual(expect.arrayContaining(all.filter(date => date >= '2026-06-15')))
    // Weekly with two weekdays: the first week holds only the start's later days.
    const weekly = 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=700'
    const stepped = dates(weekly, '2020-01-01T09:00', 1000)
    const skipped = dates(weekly, '2020-01-01T09:00', 1000, fromDay).slice(1)
    expect(skipped.length).toBeGreaterThan(2)
    expect(skipped).toEqual(stepped.slice(stepped.length - skipped.length))
  })

  it('counts every candidate of a yearly rule against the budget and stops when it runs out', () => {
    const budget = new ExpansionBudget(10_000)
    const out = [
      ...expandRrule(
        rule('FREQ=YEARLY;COUNT=999999;BYDAY=MO,TU,WE,TH,FR,SA,SU'),
        at('1000-01-01T09:00'),
        { fromDay: civilDay(2026, 6, 15), budget },
      ),
    ]
    expect(budget.exhausted).toBe(true)
    expect(out.length).toBeLessThan(10_000)
    const roomy = new ExpansionBudget(10_000)
    expect([
      ...expandRrule(rule('FREQ=WEEKLY;COUNT=10'), at('2026-06-01T09:00'), { budget: roomy }),
    ]).toHaveLength(10)
    expect(roomy.exhausted).toBe(false)
  })

  it('gives up on a rule that never matches', () => {
    expect(dates('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-01-30T09:00', 5)).toEqual([
      '2026-01-30',
    ])
  })
})
