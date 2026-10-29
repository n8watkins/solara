// Imported events (docs/integrations/EVENTS.md, phase 1): events a person imports from
// an .ics file, with the UV during each one, a burn estimate and sunscreen timing.
//
// Each one is stored as `users/{uid}/events/{key}` so every device shows it. The key is
// a hash of the source and the event's UID (plus the occurrence for a recurring event),
// so importing the same file again updates events instead of adding copies.
// firestore.rules repeats the field list and caps below; lib/firestore-rules.test.ts
// fails when the two drift. Everything here is pure, so the app and a later Function
// (subscriptions and heads-ups, phase 2) run the same logic.

import * as v from 'valibot'
import type { ExposureSetting } from './exposure'
import { planningUV, skyUV, type SkyHour } from './forecast-quality'
import { burnMins, type SkinType } from './recommendation'
import { finiteNumber, record } from './schema'
import { isIanaTimeZone, wallClockAt, isoDateOf } from './zoned-time'
import { DAY_END_HOUR, DAY_START_HOUR } from './forecast'
import { RECORD_CAPS, RECORD_LIST_LIMITS } from './record-caps'
import { sha256Hex } from './sha256'

/** Storage caps, mirrored by firestore.rules. */
export const IMPORTED_EVENT_LIMITS = Object.freeze({
  /** Keys and series ids are 32 hex characters (128 bits of SHA-256). */
  keyLength: 32,
  titleLength: 200,
  whereLength: 200,
  placeLabelLength: 120,
  timestampLength: 40,
  timezoneLength: 64,
  activityIdLength: 64,
  urlLength: 2048,
  /** Most records one list query may return (rules check `request.query.limit`). */
  listLimit: RECORD_LIST_LIMITS.events,
  /**
   * Most records one account may hold (REVIEW4 M4; default, owner may change). The rules
   * enforce it through users/{uid}/meta/events (key-lists.ts).
   */
  maxStored: RECORD_CAPS.events,
})

/**
 * Where events come from: `file` for an .ics file the person imports (phase 1, written
 * by the app), `feed` for a linked calendar Solara refreshes (phase 2, written only by
 * the server; packages/core/src/event-subscriptions.ts), `google` for an event already in
 * the person's Google Calendar (phase 2b, written by the app;
 * packages/core/src/google-calendar-events.ts), and `outlook` for an event already in the
 * person's Outlook calendar (ROADMAP item 23, written by the app;
 * packages/core/src/outlook-calendar-events.ts). A later phase may add `strava`.
 */
export const IMPORTED_EVENT_SOURCES = Object.freeze(['file', 'feed', 'google', 'outlook'] as const)

/** The sources the app writes itself (firestore.rules lets it create only these). */
export const CLIENT_EVENT_SOURCES = Object.freeze(['file', 'google', 'outlook'] as const)
export type ImportedEventSource = (typeof IMPORTED_EVENT_SOURCES)[number]
export type ClientEventSource = (typeof CLIENT_EVENT_SOURCES)[number]

/** Fields of a stored imported event, in the order firestore.rules lists them. */
export const IMPORTED_EVENT_FIELDS = Object.freeze([
  'key',
  'source',
  'seriesId',
  'title',
  'start',
  'end',
  'timeZone',
  'where',
  'lat',
  'lon',
  'placeLabel',
  'placeGuessed',
  'activityId',
  'url',
  'createdAt',
  'updatedAt',
  'feedId',
] as const)

/**
 * The fields the person may change on an event from a linked calendar (its place and
 * what it counts as); the server owns the rest. firestore.rules repeats the list.
 */
export const FEED_EVENT_CLIENT_FIELDS = Object.freeze([
  'lat',
  'lon',
  'placeLabel',
  'placeGuessed',
  'activityId',
  'updatedAt',
  'expireAt',
] as const)

/** Days a record is kept after its event ends (the app prunes, Firestore's TTL deletes). */
export const IMPORTED_EVENT_RETENTION_DAYS = 30
/** The Firestore Timestamp a stored record expires at; checked by firestore.rules. */
export const IMPORTED_EVENT_TTL_FIELD = 'expireAt'
/** The latest expiry the rules accept, in days from the write, so every record expires. */
export const IMPORTED_EVENT_MAX_TTL_DAYS = 400

/** When a stored event expires: its end plus IMPORTED_EVENT_RETENTION_DAYS. */
export function importedEventExpiry(event: { end: string }): Date {
  return new Date(Date.parse(event.end) + IMPORTED_EVENT_RETENTION_DAYS * 86_400_000)
}

export const IMPORTED_EVENT_KEY_PATTERN = /^[0-9a-f]{32}$/
/** The only event links Solara stores or renders. */
export const IMPORTED_EVENT_URL_PATTERN = /^https:\/\/[^\s/]+/

const isoInstant = v.pipe(
  v.string(),
  v.maxLength(IMPORTED_EVENT_LIMITS.timestampLength),
  v.check(value => !Number.isNaN(Date.parse(value))),
)

export const IMPORTED_EVENT_SHAPE = {
  key: v.pipe(v.string(), v.regex(IMPORTED_EVENT_KEY_PATTERN)),
  source: v.picklist(IMPORTED_EVENT_SOURCES),
  seriesId: v.pipe(v.string(), v.regex(IMPORTED_EVENT_KEY_PATTERN)),
  title: v.pipe(v.string(), v.maxLength(IMPORTED_EVENT_LIMITS.titleLength)),
  start: isoInstant,
  end: isoInstant,
  timeZone: v.pipe(
    v.string(),
    v.maxLength(IMPORTED_EVENT_LIMITS.timezoneLength),
    v.check((zone: string) => isIanaTimeZone(zone)),
  ),
  /** The event's own LOCATION text ('' when it has none). */
  where: v.pipe(v.string(), v.maxLength(IMPORTED_EVENT_LIMITS.whereLength)),
  lat: v.pipe(finiteNumber, v.minValue(-90), v.maxValue(90)),
  lon: v.pipe(finiteNumber, v.minValue(-180), v.maxValue(180)),
  /** The place the UV is for, as shown ("San Diego, California"). */
  placeLabel: v.pipe(v.string(), v.maxLength(IMPORTED_EVENT_LIMITS.placeLabelLength)),
  /** True when the place is the person's own, because the event gave none Solara could find. */
  placeGuessed: v.boolean(),
  /** The activity the event counts as, for its shade and surface ('' for none). */
  activityId: v.pipe(v.string(), v.maxLength(IMPORTED_EVENT_LIMITS.activityIdLength)),
  /** The event's https page ('' for none). */
  url: v.union([
    v.literal(''),
    v.pipe(
      v.string(),
      v.maxLength(IMPORTED_EVENT_LIMITS.urlLength),
      v.regex(IMPORTED_EVENT_URL_PATTERN),
    ),
  ]),
  createdAt: isoInstant,
  updatedAt: isoInstant,
  /** The linked calendar (event-subscriptions.ts) a `feed` event comes from; absent for files. */
  feedId: v.optional(v.pipe(v.string(), v.regex(IMPORTED_EVENT_KEY_PATTERN))),
}

export const ImportedEventSchema = v.pipe(
  record(IMPORTED_EVENT_SHAPE),
  v.check(event => Date.parse(event.end) > Date.parse(event.start), 'end must be after start'),
  v.check(
    event => (event.source === 'feed') === (event.feedId !== undefined),
    'a linked calendar event names its calendar, and only such an event does',
  ),
)
export type ImportedEvent = v.InferOutput<typeof ImportedEventSchema>

/** A stored record, or null when it does not match the schema (it is then ignored). */
export function parseImportedEvent(raw: unknown): ImportedEvent | null {
  const parsed = v.safeParse(ImportedEventSchema, raw)
  return parsed.success ? parsed.output : null
}

// ---- Keys ----------------------------------------------------------------------------

// Keys are SHA-256 digests from core's own hasher (sha256.ts): Web Crypto is missing on
// React Native's Hermes. They stay async so callers need not change if that ever moves.

/** The id shared by every occurrence of one event from one source. */
export async function importedSeriesId(source: ImportedEventSource, uid: string): Promise<string> {
  return sha256Hex(`${source}\n${uid}`).slice(0, IMPORTED_EVENT_LIMITS.keyLength)
}

/** The document key of one event (one occurrence of a recurring event). */
export async function importedEventKey(
  source: ImportedEventSource,
  uid: string,
  recurrenceId: string | null,
): Promise<string> {
  const text = `${source}\n${uid}\n${recurrenceId ?? ''}`
  return sha256Hex(text).slice(0, IMPORTED_EVENT_LIMITS.keyLength)
}

/**
 * The id shared by every occurrence of one event from one linked calendar. The calendar
 * is part of it, so the same event in two linked calendars (or in a file) never shares
 * stored records.
 */
export async function feedSeriesId(feedId: string, uid: string): Promise<string> {
  return sha256Hex(`feed\n${feedId}\n${uid}`).slice(0, IMPORTED_EVENT_LIMITS.keyLength)
}

/** The document key of one event (or occurrence) from a linked calendar. */
export async function feedEventKey(
  feedId: string,
  uid: string,
  recurrenceId: string | null,
): Promise<string> {
  const text = `feed\n${feedId}\n${uid}\n${recurrenceId ?? ''}`
  return sha256Hex(text).slice(0, IMPORTED_EVENT_LIMITS.keyLength)
}

// ---- Places --------------------------------------------------------------------------

const COUNTRY_PART =
  /^(usa|u\.s\.a\.|us|united states( of america)?|uk|united kingdom|canada|australia|new zealand)$/i

/**
 * City-level searches to try for an event's LOCATION text, best first. Street
 * addresses and postal codes are dropped ("Griffith Park, 4730 Crystal Springs Dr,
 * Los Angeles, CA 90027, USA" tries "Los Angeles, CA", then "Los Angeles"), because the
 * place search knows towns, not addresses. Text with no commas is tried as it is only
 * when it is short enough to be a town name.
 */
export function eventLocationQueries(where: string): string[] {
  const parts = where
    .split(',')
    .map(part => part.replace(/\b\d{4,6}(-\d{4})?\b/g, '').trim())
    .filter(Boolean)
  if (parts.length > 1 && COUNTRY_PART.test(parts[parts.length - 1]!)) parts.pop()
  // Town names only: no house numbers, and within the place search's 2-80 characters.
  const named = parts.filter(part => !/\d/.test(part) && part.length >= 2 && part.length <= 60)
  if (parts.length <= 1) {
    const only = named[0]
    return only && only.split(/\s+/).length <= 4 ? [only] : []
  }
  const last = named[named.length - 1]
  const beforeLast = named[named.length - 2]
  const queries: string[] = []
  // "City, ST": a short last part is a region qualifier for the part before it.
  if (last && beforeLast && last.length <= 3) queries.push(`${beforeLast}, ${last}`, beforeLast)
  else if (last) queries.push(last)
  return [...new Set(queries)].slice(0, 2)
}

/** Great-circle distance in km, to pick the right one of several same-named towns. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ---- Matching an event to an activity ------------------------------------------------

/**
 * Words that name each preset activity (tiers.ts ACTIVITY_CATEGORIES) in event
 * titles, so "Saturday 10K" counts as Running and "Beach volleyball" as nothing.
 */
export const ACTIVITY_KEYWORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  run: [
    'run',
    'runs',
    'running',
    'runners',
    '5k',
    '10k',
    'half marathon',
    'marathon',
    'parkrun',
    'race',
    'trail run',
    'ultra',
  ],
  jog: ['jog', 'jogging'],
  cycle: [
    'ride',
    'rides',
    'riding',
    'bike',
    'biking',
    'cycling',
    'cycle',
    'gran fondo',
    'criterium',
    'century',
  ],
  mtb: ['mtb', 'mountain bike', 'mountain biking'],
  sprint: ['sprint', 'sprints', 'intervals', 'track workout'],
  swim: ['swim', 'swims', 'swimming', 'open water', 'aquathlon'],
  surf: ['surf', 'surfing'],
  kayak: ['kayak', 'kayaking', 'canoe', 'canoeing', 'paddle'],
  paddle: ['sup', 'paddleboard', 'paddleboarding', 'stand up paddle'],
  walk: ['walk', 'walks', 'walking', 'stroll'],
  hike: ['hike', 'hikes', 'hiking', 'trek', 'trekking', 'trail'],
  picnic: ['picnic', 'bbq', 'barbecue', 'cookout'],
  garden: ['garden', 'gardening', 'allotment'],
  photo: ['photo walk', 'photography', 'photowalk'],
  read: ['book club', 'reading'],
  golf: ['golf', 'tee time'],
  tennis: ['tennis', 'pickleball'],
  soccer: ['soccer', 'football', 'futsal'],
  baseball: ['baseball', 'softball'],
  yoga: ['yoga'],
  bball: ['basketball', 'hoops'],
  dog: ['dog walk', 'dog park'],
  lunch: ['lunch'],
  coffee: ['coffee'],
})

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `
}

/**
 * The person's activity an event most likely is, by its title: an activity named in
 * the title first, then one whose preset keywords appear. '' when none matches.
 */
export function matchActivity(
  title: string,
  activities: readonly { id: string; name: string }[],
): string {
  const text = words(title)
  if (text.trim() === '') return ''
  for (const activity of activities) {
    const name = words(activity.name).trim()
    if (name && text.includes(` ${name} `)) return activity.id
  }
  let best: { id: string; length: number } | null = null
  for (const activity of activities) {
    for (const keyword of ACTIVITY_KEYWORDS[activity.id] ?? []) {
      if (text.includes(` ${keyword} `) && (!best || keyword.length > best.length)) {
        best = { id: activity.id, length: keyword.length }
      }
    }
  }
  return best?.id ?? ''
}

// ---- UV during an event --------------------------------------------------------------

/** One forecast hour: `uv` includes the forecast clouds; `clearSkyUV` is a cloudless sky. */
export interface HourUV extends SkyHour {
  hour: number
  /** Feels-like temperature, Celsius (weather-fit.ts), when the forecast has it. */
  feelsC?: number | null
}

export type EventUV =
  /**
   * The forecast covers the event. UVs are what the activity plans on (planningUV in
   * forecast-quality.ts): clouds counted once, then its shade and surface.
   */
  | {
      kind: 'forecast'
      /** Highest UV during the event (after shade and surface). */
      peakUV: number
      /** Time-weighted average UV during the event. */
      avgUV: number
      /** When the peak hour starts (epoch ms; the event's start if it began mid-hour). */
      peakAt: number
      /** The sky UV at the peak hour, before shade and surface. */
      forecastPeakUV: number
      /** The highest feels-like temperature during the event (Celsius), when known. */
      peakFeelsC?: number
    }
  /** The event is past the forecast the person can see; it becomes live on `fromDate`. */
  | { kind: 'later'; fromDate: string }
  /** Every forecast hour during the event is missing. */
  | { kind: 'unknown' }

export interface EventUVInput {
  start: number
  end: number
  /** The event place's IANA zone (the forecast's zone). */
  timeZone: string
  /** The forecast's hours on a date in that zone, or undefined when the date is not forecast. */
  hoursOn: (date: string) => readonly HourUV[] | undefined
  /** Days the person's plan shows, starting today (PLAN_FORECAST_DAYS). */
  planDays: number
  /** Today's date in the place's zone. */
  today: string
  /** The activity the event counts as: its cloud option, shade and surface. */
  activity?: { cloudSensitive?: boolean | null } & ExposureSetting
}

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return isoDateOf({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

/**
 * The UV during an event at its place: each forecast hour it overlaps counts for the
 * minutes it overlaps. Hours outside the forecast's daytime span (06-20) count as UV 0;
 * a missing daytime hour is left out rather than guessed. An event on a day past the
 * person's plan reports when it will be covered instead.
 */
export function eventUV({
  start,
  end,
  timeZone,
  hoursOn,
  planDays,
  today,
  activity = {},
}: EventUVInput): EventUV {
  const lastPlanDate = addDaysIso(today, planDays - 1)
  let weighted = 0
  let minutes = 0
  let peak: { uv: number; at: number; forecast: number } | null = null
  let peakFeelsC: number | undefined
  // Walk the event hour by hour in the place's wall clock.
  let t = start
  let steps = 0
  while (t < end && steps < 24 * 8) {
    steps += 1
    const local = wallClockAt(t, timeZone)
    const date = isoDateOf(local)
    const next = Math.min(end, t + (60 - local.minute) * 60_000 - local.second * 1000)
    if (date > lastPlanDate) return { kind: 'later', fromDate: addDaysIso(date, -(planDays - 1)) }
    const hours = date >= today ? hoursOn(date) : undefined
    // A day within the plan that the forecast does not have is not guessed.
    if (date >= today && !hours) return { kind: 'unknown' }
    const daytime = local.hour >= DAY_START_HOUR && local.hour <= DAY_END_HOUR
    const found = hours?.find(h => h.hour === local.hour)
    const sky = found ? skyUV(found, activity.cloudSensitive) : daytime ? null : 0
    if (sky !== null) {
      const uv = found ? planningUV(found, activity) : 0
      const forecast = sky
      const span = (next - t) / 60_000
      weighted += uv * span
      minutes += span
      if (!peak || uv > peak.uv) peak = { uv, at: t, forecast }
      if (typeof found?.feelsC === 'number')
        peakFeelsC = Math.max(peakFeelsC ?? -Infinity, found.feelsC)
    }
    t = next
  }
  if (!peak || minutes <= 0) return { kind: 'unknown' }
  return {
    kind: 'forecast',
    peakUV: peak.uv,
    avgUV: Math.round((weighted / minutes) * 10) / 10,
    peakAt: peak.at,
    forecastPeakUV: peak.forecast,
    ...(peakFeelsC !== undefined && { peakFeelsC }),
  }
}

/** UV from which sunscreen is advised (WHO: protection from UV index 3). */
export const SUNSCREEN_FROM_UV = 3
/** Reapply at least this often, and after swimming or heavy sweating. */
export const REAPPLY_EVERY_MS = 2 * 60 * 60_000

export interface SunscreenTiming {
  /** Apply from (start - 30 min) to (start - 15 min). */
  applyFrom: number
  applyBy: number
  /** Reapply times during the event, every two hours from the start. */
  reapplyAt: number[]
}

/** When to put sunscreen on for an event, or null when its peak UV is under 3. */
export function sunscreenTiming(
  start: number,
  end: number,
  peakUV: number,
): SunscreenTiming | null {
  if (!(Math.round(peakUV) >= SUNSCREEN_FROM_UV)) return null
  const reapplyAt: number[] = []
  for (let t = start + REAPPLY_EVERY_MS; t < end && reapplyAt.length < 84; t += REAPPLY_EVERY_MS) {
    reapplyAt.push(t)
  }
  return { applyFrom: start - 30 * 60_000, applyBy: start - 15 * 60_000, reapplyAt }
}

export interface EventBurn {
  /** Minutes to a burn at the peak UV without protection, or null when UV is too low. */
  minutes: number | null
  /** True when the event lasts longer than that. */
  outlasts: boolean
}

/** The burn estimate for an event: time to burn at its peak for this skin type. */
export function eventBurn(
  uv: Extract<EventUV, { kind: 'forecast' }>,
  start: number,
  end: number,
  skinType: SkinType,
): EventBurn {
  const minutes = burnMins(uv.peakUV, skinType)
  return { minutes, outlasts: minutes !== null && (end - start) / 60_000 > minutes }
}
