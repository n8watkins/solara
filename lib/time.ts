// Wall-clock time in the forecast location's time zone.
//
// Every "now" and "today" in the app comes from here, read in the zone the
// forecast is for, so the device's own zone never changes what is shown: a person
// in Tokyo looking at a Los Angeles forecast sees Los Angeles "today" and
// "now". Calendar dates travel as plain 'YYYY-MM-DD' strings and are only ever
// turned into instants through `zonedInstant`, never through the device zone.

/** A calendar date and wall-clock time in one time zone. */
export interface ZonedNow {
  /** The IANA zone this reading is for. */
  timeZone: string
  /** Today's date in that zone, YYYY-MM-DD. */
  date: string
  /** Whole hour, 0-23. */
  hour: number
  /** Minute, 0-59. */
  minute: number
  /** The instant this reading was taken (epoch ms). */
  epochMs: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** The device's IANA zone, or UTC when the runtime cannot say. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when `timeZone` is an IANA zone this runtime understands. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone) return false
  try {
    partsFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

/** The first valid zone among the candidates, else the device's zone. */
export function resolveTimeZone(...candidates: unknown[]): string {
  for (const candidate of candidates) if (isValidTimeZone(candidate)) return candidate
  return deviceTimeZone()
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(epochMs: number, timeZone: string): WallClock {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {}
  for (const part of partsFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    // Some runtimes print midnight as 24 even with h23.
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The date and time in `timeZone` at `epochMs` (default: now). */
export function zonedNow(timeZone: string, epochMs: number = Date.now()): ZonedNow {
  const w = wallClock(epochMs, timeZone)
  return {
    timeZone,
    date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
    hour: w.hour,
    minute: w.minute,
    epochMs,
  }
}

/** The current time as fractional hours (10:30 -> 10.5). */
export function fractionalHour(now: Pick<ZonedNow, 'hour' | 'minute'>): number {
  return now.hour + now.minute / 60
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parse 'YYYY-MM-DD' as a UTC midnight, or null when it is not a real date. */
function utcDate(dateStr: string): Date | null {
  const match = DATE_PATTERN.exec(dateStr)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null
}

/** True for a real calendar date written as 'YYYY-MM-DD'. */
export function isIsoDate(dateStr: unknown): dateStr is string {
  return typeof dateStr === 'string' && utcDate(dateStr) !== null
}

/** The date `days` after `dateStr` (negative goes back). Pure calendar math, no zone. */
export function addDays(dateStr: string, days: number): string {
  const date = utcDate(dateStr)
  if (!date) throw new Error(`Invalid date: ${dateStr}`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  const a = utcDate(from)
  const b = utcDate(to)
  if (!a || !b) return NaN
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Day of the month for 'YYYY-MM-DD'. */
export function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10))
}

/**
 * Format a calendar date. The date is a label, not an instant, so it is formatted
 * in UTC from UTC midnight and the device zone can never shift it to another day.
 */
export function formatDate(
  dateStr: string,
  options: Intl.DateTimeFormatOptions,
  locale: string | string[] = 'en-US',
): string {
  const date = utcDate(dateStr)
  if (!date) return dateStr
  return date.toLocaleDateString(locale, { ...options, timeZone: 'UTC' })
}

/**
 * The instant of a wall-clock time in `timeZone`: `dateStr` at `hours` (fractional,
 * 0-24) local time. An ambiguous time (a fall-back hour) maps to its first
 * occurrence; a time inside a spring-forward gap maps to an adjacent valid instant.
 */
export function zonedInstant(dateStr: string, hours: number, timeZone: string): number {
  const date = utcDate(dateStr)
  if (!date || !Number.isFinite(hours)) return NaN
  const wallMs = date.getTime() + Math.round(hours * 60) * 60_000
  // Guess with the offset in force at the wall time read as UTC, then correct
  // with the offset in force at the guess.
  const guess = wallMs - offsetMs(wallMs, timeZone)
  return wallMs - offsetMs(guess, timeZone)
}

/** The zone's UTC offset at `epochMs` in milliseconds (positive east of UTC). */
function offsetMs(epochMs: number, timeZone: string): number {
  const w = wallClock(epochMs, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - (epochMs - (((epochMs % 1000) + 1000) % 1000))
}

/** Milliseconds from `epochMs` until the start of the next wall-clock minute. */
export function msUntilNextMinute(epochMs: number = Date.now()): number {
  return 60_000 - (((epochMs % 60_000) + 60_000) % 60_000)
}
