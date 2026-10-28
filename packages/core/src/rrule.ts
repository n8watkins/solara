// iCalendar recurrence rules (RFC 5545 section 3.3.10), expanded in wall-clock time.
//
// Used by the .ics importer (ics-parse.ts) for recurring events and for VTIMEZONE
// daylight-saving rules. It supports what calendars actually send for events people
// go to: FREQ DAILY, WEEKLY, MONTHLY and YEARLY with INTERVAL, COUNT, UNTIL, BYDAY
// (with ordinals such as 2SU or -1FR), BYMONTHDAY, BYMONTH, BYSETPOS and WKST. Rules
// that need anything else (sub-daily frequencies, BYYEARDAY, BYWEEKNO, BYHOUR and the
// like) are reported as unsupported rather than expanded wrongly.

import {
  civilDay,
  daysInMonth,
  localAsUtc,
  utcAsLocal,
  weekdayOf,
  type LocalDateTime,
} from './zoned-time'

export const RRULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type RruleFrequency = (typeof RRULE_FREQUENCIES)[number]

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

export interface ByDay {
  /** 0 = Sunday. */
  weekday: number
  /** The nth weekday of the month or year (negative counts from the end); 0 for every one. */
  ordinal: number
}

export interface Rrule {
  freq: RruleFrequency
  interval: number
  count: number | null
  /** The last allowed start: an instant (UTC UNTIL) or a wall-clock time (local UNTIL). */
  until: { instant: number } | { local: LocalDateTime } | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  /** First day of the week, 0 = Sunday (default Monday). */
  weekStart: number
}

/** Parts a rule may have; anything else makes it unsupported. */
const KNOWN_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'WKST',
])

function integers(value: string, min: number, max: number, allowNegative: boolean) {
  const out: number[] = []
  for (const piece of value.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(piece)) return null
    const n = Number(piece)
    if (n === 0 || Math.abs(n) < min || Math.abs(n) > max || (!allowNegative && n < 0)) return null
    out.push(n)
  }
  return out
}

/**
 * Parses an RRULE value. `parseUntil` reads the UNTIL date-time (the caller knows the
 * event's zone). Returns null for a rule this module cannot expand faithfully.
 */
export function parseRrule(
  value: string,
  parseUntil: (raw: string) => Rrule['until'],
): Rrule | null {
  const parts = new Map<string, string>()
  for (const piece of value.split(';')) {
    if (!piece) continue
    const at = piece.indexOf('=')
    if (at <= 0) return null
    const name = piece.slice(0, at).trim().toUpperCase()
    if (!KNOWN_PARTS.has(name) || parts.has(name)) return null
    parts.set(
      name,
      piece
        .slice(at + 1)
        .trim()
        .toUpperCase(),
    )
  }
  const freq = parts.get('FREQ')
  if (!freq || !(RRULE_FREQUENCIES as readonly string[]).includes(freq)) return null
  const rule: Rrule = {
    freq: freq as RruleFrequency,
    interval: 1,
    count: null,
    until: null,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    bySetPos: [],
    weekStart: 1,
  }
  const interval = parts.get('INTERVAL')
  if (interval !== undefined) {
    if (!/^\d{1,4}$/.test(interval) || Number(interval) < 1) return null
    rule.interval = Number(interval)
  }
  const count = parts.get('COUNT')
  if (count !== undefined) {
    if (!/^\d{1,6}$/.test(count) || Number(count) < 1) return null
    rule.count = Number(count)
  }
  const until = parts.get('UNTIL')
  if (until !== undefined) {
    // RFC 5545 forbids both; a rule with both is ambiguous.
    if (rule.count !== null) return null
    rule.until = parseUntil(until)
    if (!rule.until) return null
  }
  const byDay = parts.get('BYDAY')
  if (byDay !== undefined) {
    for (const piece of byDay.split(',')) {
      const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(piece)
      if (!match) return null
      const ordinal = match[1] ? Number(match[1]) : 0
      if (Math.abs(ordinal) > 53 || (match[1] && ordinal === 0)) return null
      // Ordinals only mean something for monthly and yearly rules.
      if (ordinal !== 0 && rule.freq !== 'MONTHLY' && rule.freq !== 'YEARLY') return null
      rule.byDay.push({ weekday: WEEKDAYS.indexOf(match[2] as (typeof WEEKDAYS)[number]), ordinal })
    }
  }
  const byMonthDay = parts.get('BYMONTHDAY')
  if (byMonthDay !== undefined) {
    const days = integers(byMonthDay, 1, 31, true)
    if (!days || rule.freq === 'WEEKLY') return null
    rule.byMonthDay = days
  }
  const byMonth = parts.get('BYMONTH')
  if (byMonth !== undefined) {
    const months = integers(byMonth, 1, 12, false)
    if (!months) return null
    rule.byMonth = months
  }
  const bySetPos = parts.get('BYSETPOS')
  if (bySetPos !== undefined) {
    const positions = integers(bySetPos, 1, 366, true)
    if (!positions) return null
    rule.bySetPos = positions
  }
  const weekStart = parts.get('WKST')
  if (weekStart !== undefined) {
    const index = WEEKDAYS.indexOf(weekStart as (typeof WEEKDAYS)[number])
    if (index < 0) return null
    rule.weekStart = index
  }
  return rule
}

interface CivilDate {
  year: number
  month: number
  day: number
}

function fromCivilDay(n: number): CivilDate {
  const local = utcAsLocal(n * 86_400_000)
  return { year: local.year, month: local.month, day: local.day }
}

/** Days of a month matching BYDAY (with ordinals counted within the month). */
function monthDaysByDay(year: number, month: number, byDay: readonly ByDay[]): number[] {
  const length = daysInMonth(year, month)
  const firstWeekday = weekdayOf(year, month, 1)
  const out = new Set<number>()
  for (const { weekday, ordinal } of byDay) {
    // Every matching day, found by stepping a week at a time from the first one.
    const matching: number[] = []
    for (let day = 1 + ((weekday - firstWeekday + 7) % 7); day <= length; day += 7) {
      matching.push(day)
    }
    if (ordinal === 0) matching.forEach(day => out.add(day))
    else {
      const pick = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal]
      if (pick !== undefined) out.add(pick)
    }
  }
  return [...out]
}

/** Days of a month matching BYMONTHDAY (negative counts from the month's end). */
function monthDaysByMonthDay(year: number, month: number, byMonthDay: readonly number[]) {
  const length = daysInMonth(year, month)
  const out = new Set<number>()
  for (const n of byMonthDay) {
    const day = n > 0 ? n : length + n + 1
    if (day >= 1 && day <= length) out.add(day)
  }
  return [...out]
}

/** The candidate dates of one month for a monthly (or yearly, by month) rule. */
function monthCandidates(rule: Rrule, year: number, month: number, start: CivilDate): number[] {
  const { byDay, byMonthDay } = rule
  if (byDay.length && byMonthDay.length) {
    const allowed = new Set(monthDaysByMonthDay(year, month, byMonthDay))
    return monthDaysByDay(year, month, byDay).filter(day => allowed.has(day))
  }
  if (byDay.length) return monthDaysByDay(year, month, byDay)
  if (byMonthDay.length) return monthDaysByMonthDay(year, month, byMonthDay)
  // The start's day of the month; months without it are skipped (RFC 5545).
  return start.day <= daysInMonth(year, month) ? [start.day] : []
}

/** Days of a year matching BYDAY with ordinals counted within the year (no BYMONTH). */
function yearDaysByDay(year: number, byDay: readonly ByDay[]): CivilDate[] {
  const first = civilDay(year, 1, 1)
  const last = civilDay(year, 12, 31)
  const out = new Map<number, CivilDate>()
  for (const { weekday, ordinal } of byDay) {
    const matching: number[] = []
    const firstWeekday = weekdayOf(year, 1, 1)
    for (let n = first + ((weekday - firstWeekday + 7) % 7); n <= last; n += 7) matching.push(n)
    const picks =
      ordinal === 0
        ? matching
        : [ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal]]
    for (const n of picks) if (n !== undefined) out.set(n, fromCivilDay(n))
  }
  return [...out.values()]
}

/** The candidate dates of one period, unsorted and before BYSETPOS. */
function periodCandidates(rule: Rrule, period: number, start: CivilDate): CivilDate[] {
  const byMonth = new Set(rule.byMonth)
  const monthOk = (date: CivilDate) => !byMonth.size || byMonth.has(date.month)
  const startDay = civilDay(start.year, start.month, start.day)
  switch (rule.freq) {
    case 'DAILY': {
      const date = fromCivilDay(startDay + period * rule.interval)
      if (!monthOk(date)) return []
      if (rule.byMonthDay.length) {
        const days = monthDaysByMonthDay(date.year, date.month, rule.byMonthDay)
        if (!days.includes(date.day)) return []
      }
      if (rule.byDay.length) {
        const weekday = weekdayOf(date.year, date.month, date.day)
        if (!rule.byDay.some(b => b.weekday === weekday)) return []
      }
      return [date]
    }
    case 'WEEKLY': {
      const startWeekday = weekdayOf(start.year, start.month, start.day)
      const weekBegin = startDay - ((startWeekday - rule.weekStart + 7) % 7)
      const begin = weekBegin + period * rule.interval * 7
      const weekdays = rule.byDay.length ? rule.byDay.map(b => b.weekday) : [startWeekday]
      const out: CivilDate[] = []
      for (let offset = 0; offset < 7; offset += 1) {
        const n = begin + offset
        const date = fromCivilDay(n)
        if (weekdays.includes(weekdayOf(date.year, date.month, date.day)) && monthOk(date)) {
          out.push(date)
        }
      }
      return out
    }
    case 'MONTHLY': {
      const index = start.year * 12 + (start.month - 1) + period * rule.interval
      const year = Math.floor(index / 12)
      const month = (index % 12) + 1
      if (byMonth.size && !byMonth.has(month)) return []
      return monthCandidates(rule, year, month, start).map(day => ({ year, month, day }))
    }
    case 'YEARLY': {
      const year = start.year + period * rule.interval
      if (rule.byDay.length && !rule.byMonth.length && !rule.byMonthDay.length) {
        return yearDaysByDay(year, rule.byDay)
      }
      const months = rule.byMonth.length ? rule.byMonth : [start.month]
      return months.flatMap(month =>
        monthCandidates(rule, year, month, start).map(day => ({ year, month, day })),
      )
    }
  }
}

function applySetPos(sorted: CivilDate[], bySetPos: readonly number[]): CivilDate[] {
  if (!bySetPos.length) return sorted
  const picked = new Set<CivilDate>()
  for (const pos of bySetPos) {
    const date = pos > 0 ? sorted[pos - 1] : sorted[sorted.length + pos]
    if (date) picked.add(date)
  }
  return sorted.filter(date => picked.has(date))
}

/** How many whole periods lie between the start and `fromDay` (0 when it is not later). */
function periodsBefore(rule: Rrule, start: CivilDate, fromDay: number): number {
  const startDay = civilDay(start.year, start.month, start.day)
  if (fromDay <= startDay) return 0
  const target = fromCivilDay(fromDay)
  let periods: number
  switch (rule.freq) {
    case 'DAILY':
      periods = (fromDay - startDay) / rule.interval
      break
    case 'WEEKLY':
      periods = (fromDay - startDay) / (7 * rule.interval)
      break
    case 'MONTHLY':
      periods = ((target.year - start.year) * 12 + (target.month - start.month)) / rule.interval
      break
    case 'YEARLY':
      periods = (target.year - start.year) / rule.interval
      break
  }
  // One period of slack so nothing at the boundary is skipped.
  return Math.max(0, Math.floor(periods) - 1)
}

/**
 * Occurrences in every period after the first, when that number is fixed: a DAILY
 * rule with no BY* part, or a WEEKLY rule with no BYMONTH or BYSETPOS (its weekdays
 * all fall in every week). Null for any other rule. Lets COUNT skip whole periods.
 */
function fixedPerPeriod(rule: Rrule): number | null {
  if (rule.byMonth.length || rule.bySetPos.length || rule.byMonthDay.length) return null
  if (rule.freq === 'DAILY') return rule.byDay.length ? null : 1
  if (rule.freq === 'WEEKLY') return Math.max(1, new Set(rule.byDay.map(b => b.weekday)).size)
  return null
}

/**
 * A shared allowance of expansion work (periods stepped and candidate dates made), so
 * no input can make a parse slow: once it is spent, expansion stops early and the
 * caller sees `exhausted`.
 */
export class ExpansionBudget {
  exhausted = false
  constructor(public left: number) {}

  /** Spends `units`; false (and `exhausted`) once the allowance is gone. */
  spend(units: number): boolean {
    this.left -= units
    if (this.left < 0) this.exhausted = true
    return !this.exhausted
  }
}

export interface ExpandOptions {
  /**
   * Skip periods that end before this civil day (days since 1970). With COUNT, whole
   * periods are only skipped when each holds a fixed number of occurrences.
   */
  fromDay?: number
  /** Most periods to step through; protects against rules that never match. */
  maxPeriods?: number
  /** Work allowance shared with the caller; expansion stops when it runs out. */
  budget?: ExpansionBudget
}

/**
 * The rule's occurrences as wall-clock times, in order, starting with `dtstart` (the
 * first instance, as RFC 5545 counts it, even when it does not match the rule). The
 * caller stops iterating once it has what it needs. UNTIL given as an instant is
 * checked by the caller (it needs the zone); a local UNTIL is checked here.
 */
export function* expandRrule(
  rule: Rrule,
  dtstart: LocalDateTime,
  { fromDay, maxPeriods = 5000, budget }: ExpandOptions = {},
): Generator<LocalDateTime> {
  const start: CivilDate = { year: dtstart.year, month: dtstart.month, day: dtstart.day }
  const startMs = localAsUtc(dtstart)
  const untilLocal = rule.until && 'local' in rule.until ? localAsUtc(rule.until.local) : null
  // Without COUNT, nothing before `fromDay` matters; with it, every earlier occurrence
  // must be counted, which can be done period by period or, for fixed-size periods,
  // by multiplying.
  const skip = fromDay === undefined ? 0 : periodsBefore(rule, start, fromDay)
  const perPeriod = rule.count === null ? null : fixedPerPeriod(rule)
  const begin = rule.count === null ? skip : 0
  let emitted = 0
  if (begin === 0) {
    yield dtstart
    emitted = 1
    if (rule.count !== null && emitted >= rule.count) return
  }
  let steps = 0
  for (let period = begin; steps < maxPeriods; period += 1, steps += 1) {
    if (period === 1 && perPeriod !== null && skip > 1) {
      // Periods 1 to skip - 1 each hold perPeriod occurrences, all before fromDay.
      emitted += (skip - 1) * perPeriod
      if (emitted >= (rule.count as number)) return
      period = skip
    }
    const candidates = periodCandidates(rule, period, start)
    if (budget && !budget.spend(1 + candidates.length)) return
    candidates.sort((a, b) => civilDay(a.year, a.month, a.day) - civilDay(b.year, b.month, b.day))
    for (const date of applySetPos(candidates, rule.bySetPos)) {
      const local: LocalDateTime = {
        ...date,
        hour: dtstart.hour,
        minute: dtstart.minute,
        second: dtstart.second,
      }
      const ms = localAsUtc(local)
      // The first instance was already emitted; earlier dates never count.
      if (ms <= startMs) continue
      if (untilLocal !== null && ms > untilLocal) return
      yield local
      emitted += 1
      if (rule.count !== null && emitted >= rule.count) return
    }
  }
}
