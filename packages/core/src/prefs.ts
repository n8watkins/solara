// The user preferences document (Firestore `users/{uid}` and the browser copy) as one
// Valibot schema. The schema is the single source of truth: the TypeScript types are
// inferred from it, it normalizes whatever a past client version stored, and the key
// lists and caps in firestore.rules are checked against it (lib/firestore-rules.test.ts).
//
// Parsing is lenient on purpose: a field that does not match falls back to its default
// and a list element that does not match is dropped, so one bad value never locks a
// person out of their settings. Only the location is required.
//
// Versioning: `schemaVersion` names the document shape. Older documents are migrated
// step by step (MIGRATIONS) before parsing. A document from a newer client is parsed
// best-effort but keeps its version, and `isWritablePreferences` refuses to write it,
// so an old client never downgrades data it does not understand.

import * as v from 'valibot'
import { roundCoordinate } from './geocoding'
import { SHADE_LEVELS, SURFACES } from './exposure'
import {
  mostSensitiveSkinType,
  SKIN_TYPES,
  type PreferredHours,
  type SkinType,
} from './recommendation'
import { finiteNumber, isPlainRecord, record } from './schema'

/** The document shape this code reads and writes. Bump it with a new MIGRATIONS entry. */
export const PREFS_SCHEMA_VERSION = 2

/** Storage caps, mirrored by firestore.rules. */
export const PREFS_LIMITS = Object.freeze({
  activities: 20,
  savedLocations: 12,
  profiles: 12,
  activityNameLength: 100,
  profileNameLength: 40,
  placeNameLength: 120,
  timezoneLength: 64,
  activeProfileIdLength: 64,
  emailLength: 254,
  timestampLength: 40,
  /** An emoji, as scheduled records cap it; longer icons fall back to the default. */
  iconLength: 16,
})

export const TIER_LEVELS = Object.freeze(['anonymous', 'free', 'paid'] as const)
export type TierLevel = (typeof TIER_LEVELS)[number]

/** How to choose a start time among the feasible safe and free slots. */
export const TIME_PREFERENCES = Object.freeze(['earliest', 'latest', 'sunniest'] as const)
export type TimePreference = (typeof TIME_PREFERENCES)[number]

/**
 * Display units. 'auto' (or a missing field) follows the browser locale; the app
 * resolves it (lib/units.ts). Added without a version bump: the fields are optional,
 * older documents read as 'auto', and older clients write only the fields they know.
 */
export const TEMPERATURE_UNIT_PREFERENCES = Object.freeze([
  'auto',
  'celsius',
  'fahrenheit',
] as const)
export type TemperatureUnitPreference = (typeof TEMPERATURE_UNIT_PREFERENCES)[number]
export const CLOCK_FORMAT_PREFERENCES = Object.freeze(['auto', '12h', '24h'] as const)
export type ClockFormatPreference = (typeof CLOCK_FORMAT_PREFERENCES)[number]

/** Morning notification hour: allowed range and default. */
export const NOTIFICATION_HOUR = Object.freeze({ min: 5, max: 10, default: 7 })

/**
 * The UV alert (Pro): a push on the day today's UV index first reaches this whole
 * number. `off` (or a missing field) turns it off; clients cannot remove a field, so
 * turning it off writes `off`.
 */
export const UV_ALERT_THRESHOLD = Object.freeze({ off: 0, min: 1, max: 11 })

/**
 * Quiet hours, as whole local hours: alerts other than the morning alert (whose hour
 * the person picks) wait until `to`. `from` after `to` spans midnight; equal hours
 * mean no quiet hours. A missing field means QUIET_HOURS.default.
 */
export const QUIET_HOURS = Object.freeze({
  min: 0,
  max: 23,
  default: Object.freeze({ from: 21, to: 7 }),
})

/** Calendar view bounds: `from` is a start hour, `to` an end hour. */
export const CALENDAR_HOUR_BOUNDS = Object.freeze({
  from: { min: 0, max: 23 },
  to: { min: 1, max: 24 },
})

const ACTIVITY_DEFAULTS = Object.freeze({
  name: 'Outdoor activity',
  icon: '☀️',
  durationMins: 30,
  maxUV: 4,
})

const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const isRecord = isPlainRecord

function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

/** Trimmed text cut to `max` characters. */
function text(max: number) {
  return v.pipe(
    v.string(),
    v.transform(value => value.trim().slice(0, max)),
  )
}

/**
 * A list that keeps the elements matching `item` and drops the rest. Anything that is
 * not an array, a missing field included, reads as an empty list. `prepare` sees each
 * raw element with its index first, to fill in values that depend on the position.
 */
function listOf<S extends v.GenericSchema>(
  item: S,
  prepare: (raw: unknown, index: number) => unknown = raw => raw,
) {
  return v.optional(
    v.pipe(
      v.fallback(v.array(v.unknown()), () => []),
      v.transform(raws =>
        raws.flatMap((raw, index): v.InferOutput<S>[] => {
          const parsed = v.safeParse(item, prepare(raw, index))
          return parsed.success ? [parsed.output] : []
        }),
      ),
    ),
    () => [],
  )
}

/** Gives an object element a stable id from its position when it has none. */
function withDefaultId(prefix: string) {
  return (raw: unknown, index: number): unknown =>
    isRecord(raw) && !(typeof raw.id === 'string' && isNonBlank(raw.id))
      ? { ...raw, id: `${prefix}${index}` }
      : raw
}

function uniqueBy<T>(items: readonly T[], same: (a: T, b: T) => boolean): T[] {
  const out: T[] = []
  for (const item of items) if (!out.some(kept => same(kept, item))) out.push(item)
  return out
}

/** A deduplicated list of non-blank, trimmed strings. */
const stringSet = v.pipe(
  listOf(v.pipe(v.string(), v.trim(), v.minLength(1))),
  v.transform(values => Array.from(new Set(values))),
)

/** A non-blank icon of at most PREFS_LIMITS.iconLength characters. */
const icon = v.pipe(v.string(), v.check(isNonBlank), v.maxLength(PREFS_LIMITS.iconLength))

// ---- Location ---------------------------------------------------------------------

export const LOCATION_SHAPE = {
  lat: v.pipe(finiteNumber, v.minValue(-90), v.maxValue(90), v.transform(roundCoordinate)),
  lon: v.pipe(finiteNumber, v.minValue(-180), v.maxValue(180), v.transform(roundCoordinate)),
  city: text(PREFS_LIMITS.placeNameLength),
  region: v.fallback(text(PREFS_LIMITS.placeNameLength), ''),
  timezone: v.fallback(
    v.optional(
      v.pipe(v.string(), v.maxLength(PREFS_LIMITS.timezoneLength), v.regex(TIMEZONE_PATTERN)),
    ),
    undefined,
  ),
}

/** A place: coordinates rounded to 2 decimals, names trimmed and capped. */
export const LocationSchema = record(LOCATION_SHAPE)
export type Location = v.InferOutput<typeof LocationSchema>

/** Two places closer than the rounding grid are the same place. */
export function sameLocation(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

// ---- Profiles ---------------------------------------------------------------------

export const PROFILE_SHAPE = {
  id: v.pipe(v.string(), v.check(isNonBlank)),
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.transform(name => name.slice(0, PREFS_LIMITS.profileNameLength)),
  ),
  skinType: v.picklist(SKIN_TYPES),
  icon: v.fallback(v.optional(icon), undefined),
}

/** A person or pet whose skin type drives the safety math when selected. */
export const ProfileSchema = record(PROFILE_SHAPE)
export type Profile = v.InferOutput<typeof ProfileSchema>

// ---- Activities -------------------------------------------------------------------

/** Whole hours: `from` 0-23, `to` after `from` and at most 24. */
const preferredHours = v.pipe(
  record({ from: finiteNumber, to: finiteNumber }),
  v.transform(({ from, to }): PreferredHours => {
    const start = clamp(Math.round(from), 0, 23)
    return { from: start, to: Math.max(start + 1, Math.min(24, Math.round(to))) }
  }),
)

/** A sorted subset of 0-6 (0 = Sunday). Empty or all seven means every day: undefined. */
const daysOfWeek = v.pipe(
  v.array(v.unknown()),
  v.transform(raw => {
    const days = Array.from(
      new Set(
        raw.filter(
          (day): day is number =>
            typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
        ),
      ),
    ).sort((a, b) => a - b)
    return days.length === 0 || days.length === 7 ? undefined : days
  }),
)

/** `true`, or undefined so the stored document stays clean. */
const flag = v.pipe(
  v.unknown(),
  v.transform((value): boolean | undefined => (value === true ? true : undefined)),
)

export const ACTIVITY_SHAPE = {
  id: v.pipe(v.string(), v.check(isNonBlank)),
  name: v.pipe(
    v.string(),
    v.transform(name =>
      (name.trim() || ACTIVITY_DEFAULTS.name).slice(0, PREFS_LIMITS.activityNameLength),
    ),
  ),
  icon: v.fallback(icon, ACTIVITY_DEFAULTS.icon),
  durationMins: v.fallback(
    v.pipe(
      finiteNumber,
      v.transform(mins => Math.max(5, Math.round(mins))),
    ),
    ACTIVITY_DEFAULTS.durationMins,
  ),
  /** Base max UV assuming no sunscreen. */
  maxUV: v.fallback(
    v.pipe(
      finiteNumber,
      v.transform(uv => clamp(uv, 0, 11)),
    ),
    ACTIVITY_DEFAULTS.maxUV,
  ),
  /** Whether the recommendation assumes SPF protection. */
  sunscreen: v.fallback(v.boolean(), false),
  custom: v.optional(flag),
  preferredHours: v.fallback(v.optional(preferredHours), undefined),
  /** Default 'earliest', stored as undefined. */
  timePreference: v.fallback(
    v.optional(
      v.pipe(
        v.picklist(TIME_PREFERENCES),
        v.transform((value): TimePreference | undefined =>
          value === 'earliest' ? undefined : value,
        ),
      ),
    ),
    undefined,
  ),
  daysOfWeek: v.fallback(v.optional(daysOfWeek), undefined),
  /** Discount effective UV by cloud cover when planning. */
  cloudSensitive: v.optional(flag),
  /** Typical shade while doing it (exposure.ts); undefined is open sun. */
  shade: v.fallback(v.optional(v.picklist(SHADE_LEVELS)), undefined),
  /** The ground around it, for reflected UV (exposure.ts); undefined adds nothing. */
  surface: v.fallback(v.optional(v.picklist(SURFACES)), undefined),
}

export const ActivitySchema = v.pipe(
  record(ACTIVITY_SHAPE),
  v.transform(activity => {
    // Custom activities predate the `custom` flag; their ids carry the marker.
    if (activity.id.startsWith('custom_')) activity.custom = true
    return activity
  }),
)
export type Activity = v.InferOutput<typeof ActivitySchema>

// ---- The document -----------------------------------------------------------------

const calendarHours = v.pipe(
  record({ from: finiteNumber, to: finiteNumber }),
  v.transform(({ from, to }) => ({
    from: clamp(from, CALENDAR_HOUR_BOUNDS.from.min, CALENDAR_HOUR_BOUNDS.from.max),
    to: clamp(to, CALENDAR_HOUR_BOUNDS.to.min, CALENDAR_HOUR_BOUNDS.to.max),
  })),
)

/** A whole hour 0-23. */
const quietHour = v.pipe(
  finiteNumber,
  v.transform(hour => clamp(Math.round(hour), QUIET_HOURS.min, QUIET_HOURS.max)),
)

const upgradeInterest = record({
  email: v.fallback(
    v.optional(
      v.pipe(
        v.string(),
        v.trim(),
        v.minLength(1),
        v.transform(email => email.slice(0, PREFS_LIMITS.emailLength)),
      ),
    ),
    undefined,
  ),
  createdAt: v.pipe(
    v.string(),
    v.maxLength(PREFS_LIMITS.timestampLength),
    v.check(value => Number.isFinite(Date.parse(value))),
  ),
})

export const PREFERENCES_SHAPE = {
  uid: v.fallback(v.string(), ''),
  /** Set by `parsePreferences`; see the versioning note at the top of this file. */
  schemaVersion: v.fallback(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    PREFS_SCHEMA_VERSION,
  ),
  /** The active location. */
  location: LocationSchema,
  /**
   * Quick-switch shortcuts, deduplicated by position and capped. The active location is
   * pinned separately in the UI, so changing it is never gated; only saving extras is.
   */
  savedLocations: v.pipe(
    listOf(LocationSchema),
    v.transform(list => uniqueBy(list, sameLocation).slice(0, PREFS_LIMITS.savedLocations)),
  ),
  /** The live skin type used for all safety math (the active profile's). */
  skinType: v.fallback(v.picklist(SKIN_TYPES), 'fair'),
  /** Saved people and pets, unique by id; undefined when there are none. */
  profiles: v.optional(
    v.pipe(
      listOf(ProfileSchema, withDefaultId('profile_')),
      v.transform(list => {
        const unique = uniqueBy(list, (a, b) => a.id === b.id).slice(0, PREFS_LIMITS.profiles)
        return unique.length ? unique : undefined
      }),
    ),
  ),
  /** Kept only while it names one of `profiles`. */
  activeProfileId: v.fallback(v.optional(v.string()), undefined),
  /**
   * Planning for a group (Pro): when true, plans and burn estimates use the most
   * sensitive of the profiles in `groupProfileIds` (planningFor in packages/core/src/prefs.ts).
   * Optional and added without a version bump, like the display units.
   */
  groupMode: v.fallback(v.optional(v.boolean()), undefined),
  /** The profiles in the group; undefined means all of them. Unique, capped like `profiles`. */
  groupProfileIds: v.fallback(
    v.optional(
      v.pipe(
        v.array(v.unknown()),
        v.transform(raw =>
          Array.from(
            new Set(
              raw.filter(
                (id): id is string =>
                  typeof id === 'string' &&
                  isNonBlank(id) &&
                  id.length <= PREFS_LIMITS.activeProfileIdLength,
              ),
            ),
          ).slice(0, PREFS_LIMITS.profiles),
        ),
      ),
    ),
    undefined,
  ),
  /** Legacy global sunscreen flag; activities carry their own since version 2. */
  sunscreen: v.fallback(v.boolean(), false),
  activities: v.pipe(
    listOf(ActivitySchema, withDefaultId('migrated_')),
    v.transform(list => list.slice(0, PREFS_LIMITS.activities)),
  ),
  /** Written by the server after account creation. */
  tier: v.fallback(v.picklist(TIER_LEVELS), 'anonymous'),
  onboardingComplete: v.fallback(v.boolean(), false),
  calendarHours: v.fallback(v.optional(calendarHours), undefined),
  /** Sun-path arc on the dashboard; default on. */
  showSunPath: v.fallback(v.optional(v.boolean()), undefined),
  hiddenActivitySuggestionIds: stringSet,
  collapsedActivityCategories: stringSet,
  upgradeInterest: v.fallback(v.optional(upgradeInterest), undefined),
  notificationHour: v.fallback(
    v.pipe(
      finiteNumber,
      v.transform(hour => clamp(Math.round(hour), NOTIFICATION_HOUR.min, NOTIFICATION_HOUR.max)),
    ),
    NOTIFICATION_HOUR.default,
  ),
  /** UV alert threshold (Pro); see UV_ALERT_THRESHOLD. 0 or undefined means off. */
  uvAlertThreshold: v.fallback(
    v.optional(
      v.pipe(
        finiteNumber,
        v.transform(uv => {
          const index = Math.round(uv)
          return index < UV_ALERT_THRESHOLD.min
            ? UV_ALERT_THRESHOLD.off
            : Math.min(index, UV_ALERT_THRESHOLD.max)
        }),
      ),
    ),
    undefined,
  ),
  /** Quiet hours for alerts; see QUIET_HOURS. Undefined means the default. */
  quietHours: v.fallback(v.optional(record({ from: quietHour, to: quietHour })), undefined),
  /** Pro heads-ups before high-UV events (core event-heads-up.ts); undefined means on. */
  eventHeadsUp: v.fallback(v.optional(v.boolean()), undefined),
  /** Temperature display unit; see TEMPERATURE_UNIT_PREFERENCES. */
  temperatureUnit: v.fallback(v.optional(v.picklist(TEMPERATURE_UNIT_PREFERENCES)), undefined),
  /** 12- or 24-hour clock; see CLOCK_FORMAT_PREFERENCES. */
  clockFormat: v.fallback(v.optional(v.picklist(CLOCK_FORMAT_PREFERENCES)), undefined),
}

const DocumentSchema = record(PREFERENCES_SHAPE)

export const PreferencesSchema = v.pipe(
  DocumentSchema,
  v.transform((prefs: v.InferOutput<typeof DocumentSchema>) => {
    if (!prefs.profiles?.some(profile => profile.id === prefs.activeProfileId)) {
      delete prefs.activeProfileId
    }
    return prefs
  }),
)

export type UserPreferences = v.InferOutput<typeof PreferencesSchema>
export type CalendarHours = NonNullable<UserPreferences['calendarHours']>

/** Every field the document schema knows. */
export const PREFERENCE_FIELDS = Object.freeze(
  Object.keys(PREFERENCES_SHAPE) as (keyof UserPreferences)[],
)

/** Fields only the server may change once the account exists. */
export const SERVER_OWNED_FIELDS = Object.freeze(['uid', 'tier'] as const)

/** Fields a signed-in client may update (firestore.rules `preferenceKeys()`). */
export const CLIENT_PREFERENCE_FIELDS = Object.freeze(
  PREFERENCE_FIELDS.filter(
    field => !(SERVER_OWNED_FIELDS as readonly string[]).includes(field),
  ) as Exclude<keyof UserPreferences, (typeof SERVER_OWNED_FIELDS)[number]>[],
)

// ---- Versions and migrations ------------------------------------------------------

type PreferencesDocument = Record<string, unknown>

/**
 * `MIGRATIONS[n]` turns a version `n` document into a version `n + 1` document. Each
 * step only reshapes what changed in that version; the schema does the rest.
 */
export const MIGRATIONS: Readonly<
  Record<number, (doc: PreferencesDocument) => PreferencesDocument>
> = Object.freeze({
  // Version 1 (documents without `schemaVersion`) had one global sunscreen flag.
  // Version 2 stores it on every activity.
  1: doc => ({
    ...doc,
    schemaVersion: 2,
    activities: Array.isArray(doc.activities)
      ? doc.activities.map(activity =>
          isRecord(activity) && typeof activity.sunscreen !== 'boolean'
            ? { ...activity, sunscreen: doc.sunscreen === true }
            : activity,
        )
      : doc.activities,
  }),
})

/** The version a stored document claims: a positive integer, or 1 when it has none. */
export function storedSchemaVersion(doc: unknown): number {
  const version = isRecord(doc) ? doc.schemaVersion : undefined
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : 1
}

/** Brings an older document up to PREFS_SCHEMA_VERSION. Newer documents pass through. */
export function migratePreferences(doc: PreferencesDocument): PreferencesDocument {
  let migrated = doc
  for (let version = storedSchemaVersion(doc); version < PREFS_SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`No preferences migration from version ${version}`)
    migrated = step(migrated)
  }
  return migrated
}

export interface ParsePreferencesOptions {
  /** Used when the document has no valid location of its own. */
  fallbackLocation?: unknown
}

/**
 * Migrates and normalizes a stored preferences document. Returns null when it is not
 * an object or has no valid location (and no valid fallback).
 *
 * The result's `schemaVersion` is PREFS_SCHEMA_VERSION, or the stored version when a
 * newer client wrote the document; see `isWritablePreferences`.
 */
export function parsePreferences(
  raw: unknown,
  { fallbackLocation }: ParsePreferencesOptions = {},
): UserPreferences | null {
  if (!isRecord(raw)) return null
  const stored = storedSchemaVersion(raw)
  const doc = migratePreferences(raw)
  const location = v.is(LocationSchema, doc.location) ? doc.location : fallbackLocation
  const parsed = v.safeParse(PreferencesSchema, { ...doc, location })
  if (!parsed.success) return null
  parsed.output.schemaVersion = Math.max(stored, PREFS_SCHEMA_VERSION)
  return parsed.output
}

/** False for preferences read from a newer schema version: writing them would lose data. */
export function isWritablePreferences(prefs: Pick<UserPreferences, 'schemaVersion'>): boolean {
  return prefs.schemaVersion <= PREFS_SCHEMA_VERSION
}

export class NewerPreferencesVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(
      `These settings were saved by a newer version of Solara (schema ${schemaVersion}). ` +
        'Reload to update before changing them.',
    )
    this.name = 'NewerPreferencesVersionError'
  }
}

/**
 * The client-writable fields of `prefs` as a Firestore update. Undefined fields are
 * left out, except `profiles`, the one optional list: removing the last profile writes
 * an empty list, because the rules let clients replace fields but not remove them.
 * Throws NewerPreferencesVersionError for preferences from a newer schema version.
 */
export function clientPreferencesUpdate(prefs: UserPreferences): Record<string, unknown> {
  if (!isWritablePreferences(prefs)) throw new NewerPreferencesVersionError(prefs.schemaVersion)
  const update: Record<string, unknown> = {}
  for (const field of CLIENT_PREFERENCE_FIELDS) {
    const value = prefs[field]
    if (value !== undefined) update[field] = value
  }
  update.profiles ??= []
  return update
}

// ---- Whom plans are for -----------------------------------------------------------
//
// Shared by the dashboard, the Pro alerts and the calendar feed so they never disagree:
// one person, or a group led by its most sensitive member ("Plan for a group", Pro).

/** The preferences that decide whom a plan is for. */
export type GroupPreferences = Pick<
  UserPreferences,
  'profiles' | 'skinType' | 'groupMode' | 'groupProfileIds'
>

/** Who plans and burn estimates are for: one person, or a group led by its most sensitive. */
export interface PlanningFor {
  /** The skin type every estimate uses. */
  skinType: SkinType
  /** In group mode, the people in the group (two or more); otherwise null. */
  group: Profile[] | null
  /** In group mode, the person whose skin type is used. */
  mostSensitive: Profile | null
}

/** The saved profiles in the group: those named in `groupProfileIds`, or all when unset. */
export function groupMembers(
  prefs: Pick<GroupPreferences, 'profiles' | 'groupProfileIds'>,
): Profile[] {
  const saved = prefs.profiles ?? []
  if (!prefs.groupProfileIds) return saved
  const ids = new Set(prefs.groupProfileIds)
  return saved.filter(p => ids.has(p.id))
}

/**
 * Whom the plans are for. In group mode with two or more people in the group, the most
 * sensitive of them (lightest skin type, see mostSensitiveSkinType) sets the skin type,
 * so a plan that suits them suits everyone; ties go to the first in the list. Otherwise
 * the live skin type (the active profile's) is used.
 *
 * Group mode is turned on only on Pro (components/ProfileSwitcher.tsx), but it keeps
 * applying if the account goes back to Free with its profiles: it only ever makes the
 * estimates more cautious.
 */
export function planningFor(prefs: GroupPreferences): PlanningFor {
  const members = prefs.groupMode ? groupMembers(prefs) : []
  if (members.length < 2) return { skinType: prefs.skinType, group: null, mostSensitive: null }
  const skinType = mostSensitiveSkinType(members.map(p => p.skinType))!
  const mostSensitive = members.find(p => p.skinType === skinType)!
  return { skinType, group: members, mostSensitive }
}
