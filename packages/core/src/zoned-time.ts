// Wall-clock time in an IANA time zone, for code shared by the app and Functions
// (the .ics importer, imported events, alerts and heads-ups). It uses only Intl, so it
// runs the same in browsers and Node. The web app's own screens use lib/time.ts, which
// follows the same rules.
//
// The wall clock is read from `format()` of one fixed en-US numeric pattern, not from
// `formatToParts`: React Native's Hermes engine documents a smaller Intl (hermes
// doc/IntlAPIs.md) with DateTimeFormat's `format` and `resolvedOptions` but no
// `formatToParts`, and does not promise `hourCycle`. hermes-intl.test.ts runs core's time
// zone code on such an Intl and checks it against `formatToParts` where that exists.

/** A wall-clock date and time with no zone attached. */
export interface LocalDateTime {
  year: number
  /** 1-12. */
  month: number
  /** 1-31. */
  day: number
  /** 0-23. */
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** "06/15/2026, 17:05:09": en-US with Latin digits, the one pattern read here. */
function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** True when `timeZone` is an IANA zone (or UTC) this runtime understands. */
export function isIanaTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false
  try {
    clockFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

const CLOCK_PATTERN = /(\d+)\/(\d+)\/(\d+)\D+(\d+):(\d+):(\d+)/

/** The wall clock in `timeZone` at `epochMs`. */
export function wallClockAt(epochMs: number, timeZone: string): LocalDateTime {
  const text = clockFormatter(timeZone).format(new Date(epochMs))
  const match = CLOCK_PATTERN.exec(text)
  if (!match) throw new RangeError(`Unreadable date in ${timeZone}: ${text}`)
  const [month, day, year, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  // Some engines write midnight as 24 with a 24-hour clock.
  return { year, month, day, hour: hour % 24, minute, second }
}

/** A wall-clock time read as if it were UTC (ms), for arithmetic on local times. */
export function localAsUtc(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
}

/** The wall-clock time `ms` stands for when read as UTC (the inverse of localAsUtc). */
export function utcAsLocal(ms: number): LocalDateTime {
  const date = new Date(ms)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  }
}

/** The zone's UTC offset at `epochMs`, in ms (positive east of UTC). */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const whole = epochMs - (((epochMs % 1000) + 1000) % 1000)
  return localAsUtc(wallClockAt(whole, timeZone)) - whole
}

/**
 * The instant of a wall-clock time in `timeZone`. An ambiguous time (a fall-back
 * hour) maps to its first occurrence; a time inside a spring-forward gap maps to an
 * adjacent valid instant. Same rule as zonedInstant in lib/time.ts.
 */
export function instantInZone(local: LocalDateTime, timeZone: string): number {
  const wallMs = localAsUtc(local)
  const guess = wallMs - zoneOffsetMs(wallMs, timeZone)
  return wallMs - zoneOffsetMs(guess, timeZone)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' for a wall-clock time. */
export function isoDateOf(local: Pick<LocalDateTime, 'year' | 'month' | 'day'>): string {
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}`
}

/** The local date, 'YYYY-MM-DD', in `timeZone` at `epochMs`. */
export function zonedDate(epochMs: number, timeZone: string): string {
  return isoDateOf(wallClockAt(epochMs, timeZone))
}

/** Days in a month (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Days since 1970-01-01 for a civil date. */
export function civilDay(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** The weekday (0 = Sunday) of a civil date. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** 'YYYY-MM-DD' `days` after `dateStr` (negative goes back). */
export function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ms = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000
  return isoDateOf(utcAsLocal(ms))
}
