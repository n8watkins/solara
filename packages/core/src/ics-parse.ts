// iCalendar (RFC 5545) reader for importing events people plan to go to: an .ics file
// from Meetup, Eventbrite, a race site or any calendar. It sits next to the serializer
// (ics.ts) and, like it, uses no Firebase, browser or Node-only API, so the app parses
// a picked file in the browser and a later Function can parse a subscribed feed with
// the same code.
//
// It reads what an outdoor event needs and nothing else: line unfolding and text
// escapes, DTSTART/DTEND/DURATION with UTC, floating and TZID times (IANA names,
// Windows names, VTIMEZONE definitions), RRULE/RDATE/EXDATE recurrence with
// RECURRENCE-ID overrides, STATUS:CANCELLED, SUMMARY, LOCATION, GEO, URL and UID.
// All-day events (DTSTART as a date) are skipped: they say nothing about when someone
// is outside. Input is capped (ICS_IMPORT_LIMITS) so a hostile file cannot make it
// slow or large: the file's size, its events, its nesting, and one work allowance for
// the whole file that every recurrence expansion and date list draws on (a series that
// would need more is reported in `tooComplex`). Malformed lines are skipped rather than
// failing the whole file. The same bounds make it safe to run on a server.

import { APP_FORECAST_DAYS } from './forecast'
import { ExpansionBudget, expandRrule, parseRrule, type Rrule } from './rrule'
import { capText } from './scheduled'
import {
  civilDay,
  daysInMonth,
  instantInZone,
  isIanaTimeZone,
  localAsUtc,
  utcAsLocal,
  wallClockAt,
  type LocalDateTime,
} from './zoned-time'

export const ICS_IMPORT_LIMITS = Object.freeze({
  /** Largest file read, in bytes (1 MB). */
  maxBytes: 1024 * 1024,
  /** Most events one import keeps (the soonest). */
  maxEvents: 200,
  /** Most occurrences one recurring event contributes. */
  maxOccurrencesPerSeries: 50,
  /** Most VEVENT components read from one file. */
  maxComponents: 5000,
  /** Deepest component nesting read (VCALENDAR > VTIMEZONE > STANDARD needs 3). */
  maxDepth: 6,
  /**
   * Work one file may cost in all: recurrence periods stepped, dates made and date
   * values read. Bounds the parse to well under a second whatever the file holds.
   */
  maxWork: 200_000,
  /** Work one recurring event may cost, so one bad series cannot starve the rest. */
  maxWorkPerSeries: 20_000,
  /** Most RDATE values one VTIMEZONE observance keeps. */
  maxZoneDates: 200,
  /** Recurring events are expanded this many days ahead (the longest forecast). */
  recurrenceDays: APP_FORECAST_DAYS,
  /** One-off events further ahead than this are skipped. */
  maxFutureDays: 365,
  /** Longer events are skipped: they are not one outdoor outing. */
  maxEventDays: 7,
  titleLength: 200,
  locationLength: 200,
  uidLength: 1024,
  urlLength: 2048,
})

/** An event with a start but no end or duration is taken to last this long. */
export const DEFAULT_EVENT_DURATION_MS = 60 * 60_000

/** Why an event in the file was not imported. */
export type IcsSkipReason =
  'allDay' | 'cancelled' | 'past' | 'tooFar' | 'tooLong' | 'invalid' | 'overLimit'

export type IcsSkipCounts = Record<IcsSkipReason, number>

export interface ParsedIcsEvent {
  /** The event's UID (or a stand-in built from its start and title when it has none). */
  uid: string
  /** For one occurrence of a recurring event, its original start (ISO, UTC); else null. */
  recurrenceId: string | null
  title: string
  /** Epoch ms. */
  start: number
  end: number
  /** The IANA zone the event's times were written in (the default zone for floating times). */
  timeZone: string
  /** The LOCATION text, if any. */
  location: string | null
  /** Coordinates from GEO, if valid. */
  geo: { lat: number; lon: number } | null
  /** An https link to the event's page, if given. */
  url: string | null
}

/** An event (or one occurrence of a recurring event) the file marks STATUS:CANCELLED. */
export interface IcsCancellation {
  uid: string
  /** The cancelled occurrence's original start (ISO, UTC); null for the whole event. */
  recurrenceId: string | null
}

/**
 * A recurring event the file was read in full for: its occurrences that end after
 * `now` and start before `until` are exactly the ones in `events`, so any other stored
 * occurrence in that range is gone from the source.
 */
export interface IcsSeriesCoverage {
  uid: string
  /** Epoch ms; null when the series has no occurrence after the ones returned. */
  until: number | null
}

export interface IcsParseResult {
  /** Upcoming events, soonest first, at most ICS_IMPORT_LIMITS.maxEvents. */
  events: ParsedIcsEvent[]
  skipped: IcsSkipCounts
  /** Events and occurrences the file cancels, so a re-import can remove them. */
  cancelled: IcsCancellation[]
  /** Recurring events read in full (see IcsSeriesCoverage). */
  series: IcsSeriesCoverage[]
  /** Recurring events whose rule could not be expanded (only their first date was read). */
  unsupportedRecurrence: number
  /** Recurring events cut short by the work allowance (ICS_IMPORT_LIMITS.maxWork). */
  tooComplex: number
  /** Events whose TZID could not be resolved (read in the default zone). */
  unknownTimeZone: number
  /** X-WR-CALNAME, if given. */
  calendarName: string | null
}

export type IcsImportErrorCode = 'too-large' | 'not-calendar'

export class IcsImportError extends Error {
  constructor(
    readonly code: IcsImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'IcsImportError'
  }
}

export interface IcsParseOptions {
  /** "Now" (epoch ms): events that have ended are skipped. */
  now: number
  /** IANA zone for floating times and unresolvable TZIDs (normally the person's place). */
  defaultTimeZone: string
}

// ---- Content lines -------------------------------------------------------------------

interface Property {
  name: string
  params: Map<string, string>
  value: string
}

interface Component {
  name: string
  props: Property[]
  children: Component[]
}

/** RFC 5545 unfolding: a line starting with a space or tab continues the previous one. */
export function unfoldLines(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += raw.slice(1)
    } else if (raw.trim()) {
      lines.push(raw)
    }
  }
  return lines
}

/** One content line: NAME *(;PARAM=value) : value. Null when it is not one. */
export function parseContentLine(line: string): Property | null {
  const nameMatch = /^[A-Za-z0-9-]+/.exec(line)
  if (!nameMatch) return null
  const name = nameMatch[0].toUpperCase()
  const params = new Map<string, string>()
  let i = nameMatch[0].length
  while (line[i] === ';') {
    i += 1
    const eq = line.indexOf('=', i)
    if (eq < 0) return null
    const paramName = line.slice(i, eq).trim().toUpperCase()
    if (!/^[A-Z0-9-]+$/.test(paramName)) return null
    i = eq + 1
    const values: string[] = []
    for (;;) {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1)
        if (close < 0) return null
        values.push(line.slice(i + 1, close))
        i = close + 1
      } else {
        let end = i
        while (end < line.length && !';:,'.includes(line[end] as string)) end += 1
        values.push(line.slice(i, end))
        i = end
      }
      if (line[i] !== ',') break
      i += 1
    }
    params.set(paramName, values.join(','))
  }
  if (line[i] !== ':') return null
  return { name, params, value: line.slice(i + 1) }
}

function buildTree(lines: readonly string[]): { root: Component; eventsDropped: number } {
  const root: Component = { name: '', props: [], children: [] }
  const stack: Component[] = [root]
  let events = 0
  let eventsDropped = 0
  // While inside a dropped component (an event past the limit, or anything nested
  // deeper than maxDepth), its lines are read but not kept. The stack never grows past
  // maxDepth, so closing an unmatched END costs at most that many steps.
  let dropDepth = 0
  for (const line of lines) {
    const prop = parseContentLine(line)
    if (!prop) continue
    const value = prop.value.trim().toUpperCase()
    if (prop.name === 'BEGIN' && value) {
      const overLimit = value === 'VEVENT' && events >= ICS_IMPORT_LIMITS.maxComponents
      if (dropDepth > 0 || overLimit || stack.length > ICS_IMPORT_LIMITS.maxDepth) {
        if (dropDepth === 0 && value === 'VEVENT') eventsDropped += 1
        dropDepth += 1
        continue
      }
      if (value === 'VEVENT') events += 1
      const component: Component = { name: value, props: [], children: [] }
      stack[stack.length - 1]?.children.push(component)
      stack.push(component)
      continue
    }
    if (prop.name === 'END' && value) {
      if (dropDepth > 0) {
        dropDepth -= 1
        continue
      }
      // Close the matching component; an END with no match is ignored.
      const at = stack.findLastIndex((c, index) => index > 0 && c.name === value)
      if (at > 0) stack.length = at
      continue
    }
    if (dropDepth === 0 && stack.length > 1) stack[stack.length - 1]?.props.push(prop)
  }
  return { root, eventsDropped }
}

const first = (c: Component, name: string) => c.props.find(p => p.name === name)
const all = (c: Component, name: string) => c.props.filter(p => p.name === name)

/** TEXT unescaping (RFC 5545 3.3.11). */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  )
}

/**
 * Invisible characters that change how the text around them is shown: bidirectional
 * marks, embeddings, overrides and isolates (U+061C, U+200E, U+200F, U+202A-U+202E,
 * U+2066-U+2069), zero-width space, word joiner and byte order mark. A title such as
 * "photo\u202Egnp.exe" would otherwise read as "photoexe.png". Zero-width (non-)joiners
 * stay: emoji sequences and several scripts need them.
 */
const INVISIBLE_FORMATTING = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

/** Text with the invisible formatting characters above removed. */
export function stripInvisibleFormatting(value: string): string {
  return value.replace(INVISIBLE_FORMATTING, '')
}

/**
 * Text for display: unescaped, invisible formatting removed, control characters and
 * runs of whitespace made one space.
 */
function cleanText(value: string, max: number): string {
  const text = stripInvisibleFormatting(unescapeText(value))
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
  return capText(text, max)
}

// ---- Times ---------------------------------------------------------------------------

type TimeValue =
  | { kind: 'date'; year: number; month: number; day: number }
  | { kind: 'datetime'; local: LocalDateTime; utc: boolean }

/** A DATE or DATE-TIME value; null when malformed or not a real date. */
export function parseTimeValue(raw: string): TimeValue | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(raw.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  if (match[4] === undefined) return { kind: 'date', year, month, day }
  const hour = Number(match[4])
  const minute = Number(match[5])
  // A leap second reads as the second before it.
  const second = Math.min(59, Number(match[6] ?? 0))
  if (hour > 23 || minute > 59) return null
  return {
    kind: 'datetime',
    local: { year, month, day, hour, minute, second },
    utc: match[7] !== undefined,
  }
}

/** A UTC offset such as -0700 or +053000, in ms. */
function parseOffset(raw: string | undefined): number | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(raw?.trim() ?? '')
  if (!match) return null
  const ms = (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)) * 1000
  return match[1] === '-' ? -ms : ms
}

/** A DURATION value in ms (nominal days count as 24 hours); null when malformed. */
export function parseDuration(raw: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    raw.trim(),
  )
  if (!match || !/\d/.test(raw)) return null
  const [, sign, w, d, h, m, s] = match
  const seconds =
    Number(w ?? 0) * 604_800 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0)
  return (sign === '-' ? -1 : 1) * seconds * 1000
}

/** How wall-clock times of one TZID become instants. */
interface Zone {
  /** The IANA zone stored with the event. */
  name: string
  toInstant: (local: LocalDateTime) => number
}

const UTC_ZONE: Zone = { name: 'UTC', toInstant: localAsUtc }

function ianaZone(name: string): Zone {
  return { name, toInstant: local => instantInZone(local, name) }
}

/**
 * Windows zone names (Outlook and Exchange write these as TZID), mapped to the IANA
 * zone of their main city as in CLDR's windowsZones.xml. Outlook also sends a VTIMEZONE,
 * which covers names missing here.
 */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'dateline standard time': 'Etc/GMT+12',
  'hawaiian standard time': 'Pacific/Honolulu',
  'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana',
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'mountain standard time (mexico)': 'America/Mazatlan',
  'central standard time': 'America/Chicago',
  'central standard time (mexico)': 'America/Mexico_City',
  'canada central standard time': 'America/Regina',
  'central america standard time': 'America/Guatemala',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indianapolis',
  'sa pacific standard time': 'America/Bogota',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',
  'pacific sa standard time': 'America/Santiago',
  'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Buenos_Aires',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'w. central africa standard time': 'Africa/Lagos',
  'gtb standard time': 'Europe/Bucharest',
  'fle standard time': 'Europe/Helsinki',
  'e. europe standard time': 'Europe/Chisinau',
  'turkey standard time': 'Europe/Istanbul',
  'israel standard time': 'Asia/Jerusalem',
  'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg',
  'russian standard time': 'Europe/Moscow',
  'arab standard time': 'Asia/Riyadh',
  'arabian standard time': 'Asia/Dubai',
  'iran standard time': 'Asia/Tehran',
  'pakistan standard time': 'Asia/Karachi',
  'india standard time': 'Asia/Calcutta',
  'nepal standard time': 'Asia/Katmandu',
  'bangladesh standard time': 'Asia/Dhaka',
  'se asia standard time': 'Asia/Bangkok',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'taipei standard time': 'Asia/Taipei',
  'w. australia standard time': 'Australia/Perth',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin',
  'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney',
  'tasmania standard time': 'Australia/Hobart',
  'new zealand standard time': 'Pacific/Auckland',
}

/**
 * The IANA zone a Windows zone name stands for ("Pacific Standard Time" is
 * America/Los_Angeles), or null for a name the table does not know. Outlook's Graph API
 * names an event's zone this way (lib/outlook-events.ts).
 */
export function windowsZoneToIana(name: string): string | null {
  const zone = WINDOWS_ZONES[name.trim().toLowerCase()]
  return zone && isIanaTimeZone(zone) ? zone : null
}

/** An IANA name inside a longer TZID, such as /mozilla.org/20050126_1/America/New_York. */
function ianaSuffix(tzid: string): string | null {
  const segments = tzid.split('/').filter(Boolean)
  for (let take = Math.min(3, segments.length); take >= 2; take -= 1) {
    const candidate = segments.slice(-take).join('/')
    if (isIanaTimeZone(candidate)) return candidate
  }
  return null
}

interface Observance {
  start: LocalDateTime
  offsetTo: number
  rule: Rrule | null
  dates: LocalDateTime[]
}

/**
 * A zone defined only by its VTIMEZONE (its STANDARD and DAYLIGHT observances). Each
 * conversion draws on the file's work allowance; once it is spent, conversions use the
 * offsets found so far.
 */
function vtimezoneZone(
  component: Component,
  displayName: string,
  work: ExpansionBudget,
): Zone | null {
  const observances: Observance[] = []
  for (const child of component.children) {
    if (child.name !== 'STANDARD' && child.name !== 'DAYLIGHT') continue
    const start = parseTimeValue(first(child, 'DTSTART')?.value ?? '')
    const offsetTo = parseOffset(first(child, 'TZOFFSETTO')?.value)
    if (!start || start.kind !== 'datetime' || offsetTo === null) continue
    const ruleValue = first(child, 'RRULE')?.value
    const rule = ruleValue
      ? parseRrule(ruleValue, raw => {
          const until = parseTimeValue(raw)
          if (!until) return null
          return until.kind === 'date'
            ? { local: { ...until, hour: 23, minute: 59, second: 59 } }
            : { instant: localAsUtc(until.local) }
        })
      : null
    const dates = all(child, 'RDATE')
      .flatMap(p => p.value.split(','))
      .map(parseTimeValue)
      .flatMap(v => (v?.kind === 'datetime' ? [v.local] : []))
      .slice(0, ICS_IMPORT_LIMITS.maxZoneDates)
    observances.push({ start: start.local, offsetTo, rule, dates })
  }
  if (!observances.length) return null
  const earliest = observances.reduce((a, b) =>
    localAsUtc(a.start) <= localAsUtc(b.start) ? a : b,
  )
  return {
    name: displayName,
    toInstant(local) {
      const at = localAsUtc(local)
      let best: { onset: number; offset: number } | null = null
      const consider = (onset: number, offset: number) => {
        if (onset <= at && (!best || onset > best.onset)) best = { onset, offset }
      }
      for (const obs of observances) {
        consider(localAsUtc(obs.start), obs.offsetTo)
        if (!work.spend(1 + obs.dates.length)) continue
        for (const date of obs.dates) consider(localAsUtc(date), obs.offsetTo)
        if (!obs.rule) continue
        const fromDay = civilDay(local.year - 1, 1, 1)
        const options = { fromDay, maxPeriods: 400, budget: work }
        for (const onset of expandRrule(obs.rule, obs.start, options)) {
          const ms = localAsUtc(onset)
          if (ms > at) break
          if (obs.rule.until && 'instant' in obs.rule.until && ms > obs.rule.until.instant) break
          consider(ms, obs.offsetTo)
        }
      }
      const offset = (best as { offset: number } | null)?.offset ?? earliest.offsetTo
      return at - offset
    },
  }
}

interface ZoneContext {
  timezones: Map<string, Component>
  defaultZone: Zone
  cache: Map<string, Zone | null>
  /** The file's work allowance (ICS_IMPORT_LIMITS.maxWork). */
  work: ExpansionBudget
}

/** The zone a TZID names, or null when it cannot be resolved. */
function resolveTzid(tzid: string, context: ZoneContext): Zone | null {
  const cached = context.cache.get(tzid)
  if (cached !== undefined) return cached
  const name: string = tzid.trim()
  const lower = name.toLowerCase()
  let zone: Zone | null = null
  if (isIanaTimeZone(name)) zone = name === 'UTC' ? UTC_ZONE : ianaZone(name)
  else {
    const suffix = ianaSuffix(name)
    const windows = WINDOWS_ZONES[lower]
    const definition = context.timezones.get(name)
    const licensed = definition && first(definition, 'X-LIC-LOCATION')?.value.trim()
    if (suffix) zone = ianaZone(suffix)
    else if (windows && isIanaTimeZone(windows)) zone = ianaZone(windows)
    else if (licensed && isIanaTimeZone(licensed)) zone = ianaZone(licensed)
    else if (definition) zone = vtimezoneZone(definition, context.defaultZone.name, context.work)
  }
  context.cache.set(tzid, zone)
  return zone
}

interface EventTime {
  local: LocalDateTime
  zone: Zone
  instant: number
}

type ReadTime =
  { kind: 'date' } | { kind: 'time'; time: EventTime; zoneKnown: boolean } | { kind: 'invalid' }

function readTime(prop: Property | undefined, context: ZoneContext): ReadTime {
  if (!prop) return { kind: 'invalid' }
  const value = parseTimeValue(prop.value)
  if (!value) return { kind: 'invalid' }
  if (value.kind === 'date' || prop.params.get('VALUE')?.toUpperCase() === 'DATE') {
    return { kind: 'date' }
  }
  if (value.utc) {
    return {
      kind: 'time',
      time: { local: value.local, zone: UTC_ZONE, instant: localAsUtc(value.local) },
      zoneKnown: true,
    }
  }
  const tzid = prop.params.get('TZID')
  const resolved = tzid ? resolveTzid(tzid, context) : null
  const zone = resolved ?? context.defaultZone
  return {
    kind: 'time',
    time: { local: value.local, zone, instant: zone.toInstant(value.local) },
    zoneKnown: !tzid || resolved !== null,
  }
}

/**
 * The instants in a multi-valued EXDATE or RDATE property. Each value draws on the
 * file's work allowance; values past it are not read.
 */
function instantsOf(props: readonly Property[], context: ZoneContext, fallback: Zone): number[] {
  const out: number[] = []
  for (const prop of props) {
    const tzid = prop.params.get('TZID')
    const zone = (tzid && resolveTzid(tzid, context)) || fallback
    for (const raw of prop.value.split(',')) {
      if (!context.work.spend(1)) return out
      // RDATE;VALUE=PERIOD gives start/end; the start is the occurrence.
      const value = parseTimeValue(raw.split('/')[0] ?? '')
      if (value?.kind !== 'datetime') continue
      out.push(value.utc ? localAsUtc(value.local) : zone.toInstant(value.local))
    }
  }
  return out
}

/** Dates (YYYYMMDD) excluded whole by EXDATE;VALUE=DATE. */
function excludedDates(props: readonly Property[]): Set<string> {
  const out = new Set<string>()
  for (const prop of props) {
    for (const raw of prop.value.split(',')) {
      const value = parseTimeValue(raw)
      if (value?.kind === 'date') out.add(`${value.year}-${value.month}-${value.day}`)
    }
  }
  return out
}

// ---- Events --------------------------------------------------------------------------

interface EventFields {
  title: string
  location: string | null
  geo: { lat: number; lon: number } | null
  url: string | null
}

function parseGeo(value: string | undefined): { lat: number; lon: number } | null {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*[;,]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(value ?? '')
  if (!match) return null
  const lat = Number(match[1])
  const lon = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** An https link, or null: other schemes (javascript:, data:, http:) are dropped. */
export function safeEventUrl(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw || raw.length > ICS_IMPORT_LIMITS.urlLength) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname ? url.href : null
  } catch {
    return null
  }
}

function fieldsOf(event: Component): EventFields {
  const location = cleanText(
    first(event, 'LOCATION')?.value ?? '',
    ICS_IMPORT_LIMITS.locationLength,
  )
  return {
    title: cleanText(first(event, 'SUMMARY')?.value ?? '', ICS_IMPORT_LIMITS.titleLength),
    location: location || null,
    geo: parseGeo(first(event, 'GEO')?.value),
    url: safeEventUrl(first(event, 'URL')?.value),
  }
}

interface Timing {
  start: EventTime
  durationMs: number
}

type TimingResult =
  { ok: true; timing: Timing; zoneKnown: boolean } | { ok: false; reason: IcsSkipReason }

function timingOf(event: Component, context: ZoneContext): TimingResult {
  const start = readTime(first(event, 'DTSTART'), context)
  if (start.kind === 'date') return { ok: false, reason: 'allDay' }
  if (start.kind === 'invalid') return { ok: false, reason: 'invalid' }
  let durationMs: number | null = null
  const endProp = first(event, 'DTEND')
  if (endProp) {
    const end = readTime(endProp, context)
    if (end.kind !== 'time') return { ok: false, reason: 'invalid' }
    durationMs = end.time.instant - start.time.instant
  } else {
    const duration = first(event, 'DURATION')
    if (duration) {
      durationMs = parseDuration(duration.value)
      if (durationMs === null) return { ok: false, reason: 'invalid' }
    }
  }
  if (durationMs !== null && durationMs < 0) return { ok: false, reason: 'invalid' }
  if (!durationMs) durationMs = DEFAULT_EVENT_DURATION_MS
  if (durationMs > ICS_IMPORT_LIMITS.maxEventDays * 86_400_000) {
    return { ok: false, reason: 'tooLong' }
  }
  return { ok: true, timing: { start: start.time, durationMs }, zoneKnown: start.zoneKnown }
}

function isCancelled(event: Component): boolean {
  return first(event, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
}

function uidOf(event: Component): string {
  const uid = capText(first(event, 'UID')?.value ?? '', ICS_IMPORT_LIMITS.uidLength)
  if (uid) return uid
  // No UID: the start and title identify it well enough for re-imports of the same file.
  return `no-uid:${first(event, 'DTSTART')?.value ?? ''}:${first(event, 'SUMMARY')?.value ?? ''}`
}

const emptySkips = (): IcsSkipCounts => ({
  allDay: 0,
  cancelled: 0,
  past: 0,
  tooFar: 0,
  tooLong: 0,
  invalid: 0,
  overLimit: 0,
})

/**
 * Parses an iCalendar document into the upcoming events it holds, soonest first.
 * Throws IcsImportError when the text is too large or is not a calendar at all;
 * anything wrong inside the calendar only skips the events it affects.
 */
export function parseIcs(text: string, { now, defaultTimeZone }: IcsParseOptions): IcsParseResult {
  // A UTF-16 string is never longer than its UTF-8 bytes, so this is a lower bound.
  if (text.length > ICS_IMPORT_LIMITS.maxBytes) {
    throw new IcsImportError('too-large', 'The file is larger than 1 MB')
  }
  const { root, eventsDropped } = buildTree(unfoldLines(text.replace(/^﻿/, '')))
  const calendars = root.children.filter(c => c.name === 'VCALENDAR')
  if (!calendars.length) {
    throw new IcsImportError('not-calendar', 'The file is not an iCalendar (.ics) file')
  }

  const skipped = emptySkips()
  skipped.overLimit += eventsDropped
  let unsupportedRecurrence = 0
  let tooComplex = 0
  let unknownTimeZone = 0
  const work = new ExpansionBudget(ICS_IMPORT_LIMITS.maxWork)
  const cancelled: IcsCancellation[] = []
  const series: IcsSeriesCoverage[] = []
  const horizon = now + ICS_IMPORT_LIMITS.recurrenceDays * 86_400_000
  const farthest = now + ICS_IMPORT_LIMITS.maxFutureDays * 86_400_000
  const results: ParsedIcsEvent[] = []
  let calendarName: string | null = null

  for (const calendar of calendars) {
    calendarName ??= cleanText(first(calendar, 'X-WR-CALNAME')?.value ?? '', 120) || null
    const timezones = new Map<string, Component>()
    for (const tz of calendar.children.filter(c => c.name === 'VTIMEZONE')) {
      const id = first(tz, 'TZID')?.value.trim()
      if (id) timezones.set(id, tz)
    }
    const fallback = isIanaTimeZone(defaultTimeZone) ? defaultTimeZone : 'UTC'
    const context: ZoneContext = {
      timezones,
      defaultZone: fallback === 'UTC' ? UTC_ZONE : ianaZone(fallback),
      cache: new Map(),
      work,
    }

    // Masters and their RECURRENCE-ID overrides, by UID.
    const masters = new Map<string, Component>()
    const overrides = new Map<string, Component[]>()
    for (const event of calendar.children.filter(c => c.name === 'VEVENT')) {
      const uid = uidOf(event)
      if (first(event, 'RECURRENCE-ID')) {
        const list = overrides.get(uid)
        if (list) list.push(event)
        else overrides.set(uid, [event])
      } else if (!masters.has(uid)) {
        masters.set(uid, event)
      }
    }

    const emit = (
      uid: string,
      recurrenceId: number | null,
      fields: EventFields,
      start: number,
      durationMs: number,
      zone: Zone,
    ) => {
      results.push({
        uid,
        recurrenceId: recurrenceId === null ? null : new Date(recurrenceId).toISOString(),
        ...fields,
        start,
        end: start + durationMs,
        timeZone: zone.name,
      })
    }

    for (const [uid, master] of masters) {
      if (isCancelled(master)) {
        skipped.cancelled += 1
        cancelled.push({ uid, recurrenceId: null })
        continue
      }
      const timing = timingOf(master, context)
      if (!timing.ok) {
        skipped[timing.reason] += 1
        continue
      }
      if (!timing.zoneKnown) unknownTimeZone += 1
      const { start, durationMs } = timing.timing
      const fields = fieldsOf(master)
      const ruleValue = first(master, 'RRULE')?.value
      const rdates = all(master, 'RDATE')
      const recurring = !!ruleValue || rdates.length > 0
      const rule = ruleValue
        ? parseRrule(ruleValue, raw => {
            const until = parseTimeValue(raw)
            if (!until) return null
            if (until.kind === 'date')
              return { local: { ...until, hour: 23, minute: 59, second: 59 } }
            return until.utc ? { instant: localAsUtc(until.local) } : { local: until.local }
          })
        : null
      if (ruleValue && !rule) unsupportedRecurrence += 1

      if (!recurring || (ruleValue && !rule && !rdates.length)) {
        // A one-off event (or a rule that cannot be expanded: its first date only).
        if (start.instant + durationMs <= now) skipped.past += 1
        else if (start.instant > farthest) skipped.tooFar += 1
        else emit(uid, null, fields, start.instant, durationMs, start.zone)
        continue
      }

      // Original starts of the occurrences that matter, before overrides.
      const excluded = new Set(instantsOf(all(master, 'EXDATE'), context, start.zone))
      const excludedDays = excludedDates(all(master, 'EXDATE'))
      const keep = (instant: number) => {
        if (excluded.has(instant)) return false
        const local =
          start.zone === UTC_ZONE ? utcAsLocal(instant) : wallClockAt(instant, start.zone.name)
        return !excludedDays.has(`${local.year}-${local.month}-${local.day}`)
      }
      const starts = new Set<number>()
      let nextAfterHorizon: number | null = null
      // Every original start before this instant (exclusive) was read; Infinity when the
      // series ends, null when it was not read in full.
      let coverUntil: number | null = Infinity
      if (rule) {
        const fromLocal =
          start.zone === UTC_ZONE ? utcAsLocal(now) : wallClockAt(now, start.zone.name)
        const fromDay =
          civilDay(fromLocal.year, fromLocal.month, fromLocal.day) -
          Math.ceil(durationMs / 86_400_000) -
          1
        const budget = new ExpansionBudget(
          Math.min(ICS_IMPORT_LIMITS.maxWorkPerSeries, Math.max(0, work.left)),
        )
        const allowance = budget.left
        // No zone is more than a day from UTC, so a wall-clock time that ended more
        // than two days before `now` read as UTC has surely ended: skip it without the
        // (slower) zone conversion.
        const pastBefore = now - durationMs - 2 * 86_400_000
        for (const local of expandRrule(rule, start.local, { fromDay, budget })) {
          if (localAsUtc(local) < pastBefore) continue
          const instant = start.zone.toInstant(local)
          if (rule.until && 'instant' in rule.until && instant > rule.until.instant) break
          if (instant > farthest) {
            coverUntil = instant
            break
          }
          if (instant + durationMs <= now || !keep(instant)) continue
          if (instant >= horizon) {
            nextAfterHorizon = instant
            coverUntil = instant
            break
          }
          starts.add(instant)
          if (starts.size >= ICS_IMPORT_LIMITS.maxOccurrencesPerSeries) {
            coverUntil = instant + 1
            break
          }
        }
        work.spend(allowance - budget.left)
        if (budget.exhausted) {
          tooComplex += 1
          coverUntil = null
        }
      } else {
        // RDATE-only series: DTSTART is its first occurrence.
        if (keep(start.instant)) starts.add(start.instant)
      }
      for (const instant of instantsOf(rdates, context, start.zone)) {
        if (instant + durationMs > now && instant < horizon && keep(instant)) starts.add(instant)
      }
      // RDATEs are read up to the horizon only; a rule that could not be expanded not at all.
      if (rdates.length && coverUntil !== null) coverUntil = Math.min(coverUntil, horizon)
      if (ruleValue && !rule) coverUntil = null

      const occurrences = new Map<
        number,
        { start: number; duration: number; fields: EventFields }
      >()
      for (const instant of [...starts].sort((a, b) => a - b)) {
        if (occurrences.size >= ICS_IMPORT_LIMITS.maxOccurrencesPerSeries) {
          if (coverUntil !== null) coverUntil = Math.min(coverUntil, instant)
          break
        }
        if (instant + durationMs > now && instant < horizon) {
          occurrences.set(instant, { start: instant, duration: durationMs, fields })
        }
      }

      for (const override of overrides.get(uid) ?? []) {
        const original = readTime(first(override, 'RECURRENCE-ID'), context)
        if (original.kind !== 'time') continue
        const id = original.time.instant
        if (isCancelled(override)) {
          occurrences.delete(id)
          cancelled.push({ uid, recurrenceId: new Date(id).toISOString() })
          continue
        }
        const moved = timingOf(override, context)
        if (!moved.ok) {
          occurrences.delete(id)
          continue
        }
        const begins = moved.timing.start.instant
        const duration = moved.timing.durationMs
        if (begins + duration <= now || begins >= horizon) {
          occurrences.delete(id)
          continue
        }
        // Fields the override leaves out come from the series.
        const own = fieldsOf(override)
        occurrences.set(id, {
          start: begins,
          duration,
          fields: {
            title: own.title || fields.title,
            location: own.location ?? fields.location,
            geo: own.geo ?? fields.geo,
            url: own.url ?? fields.url,
          },
        })
      }
      overrides.delete(uid)

      if (!occurrences.size && nextAfterHorizon !== null) {
        // Nothing within the forecast range: show the next one so the series is visible.
        occurrences.set(nextAfterHorizon, { start: nextAfterHorizon, duration: durationMs, fields })
      }
      if (!occurrences.size) skipped.past += 1
      for (const [id, occurrence] of occurrences) {
        emit(uid, id, occurrence.fields, occurrence.start, occurrence.duration, start.zone)
      }
      if (coverUntil !== null) {
        series.push({ uid, until: coverUntil === Infinity ? null : coverUntil })
      }
    }

    // Overrides whose series is not in the file stand on their own.
    for (const [uid, list] of overrides) {
      for (const override of list) {
        const original = readTime(first(override, 'RECURRENCE-ID'), context)
        if (isCancelled(override)) {
          skipped.cancelled += 1
          if (original.kind === 'time') {
            cancelled.push({ uid, recurrenceId: new Date(original.time.instant).toISOString() })
          }
          continue
        }
        const timing = timingOf(override, context)
        if (!timing.ok) {
          skipped[timing.reason] += 1
          continue
        }
        const { start, durationMs } = timing.timing
        if (start.instant + durationMs <= now) skipped.past += 1
        else if (start.instant > farthest) skipped.tooFar += 1
        else {
          const id = original.kind === 'time' ? original.time.instant : start.instant
          emit(uid, id, fieldsOf(override), start.instant, durationMs, start.zone)
        }
      }
    }
  }

  results.sort((a, b) => a.start - b.start || a.uid.localeCompare(b.uid))
  if (results.length > ICS_IMPORT_LIMITS.maxEvents) {
    skipped.overLimit += results.length - ICS_IMPORT_LIMITS.maxEvents
    // Occurrences past the cut were read but not returned: no series covers them.
    const cut = (results[ICS_IMPORT_LIMITS.maxEvents] as ParsedIcsEvent).start
    for (const item of series) item.until = Math.min(item.until ?? Infinity, cut)
    results.length = ICS_IMPORT_LIMITS.maxEvents
  }
  return {
    events: results,
    skipped,
    cancelled,
    series,
    unsupportedRecurrence,
    tooComplex,
    unknownTimeZone,
    calendarName,
  }
}
