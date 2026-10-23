// The user preferences document (Firestore `users/{uid}` and the browser copy) as one
// zod/mini schema. The schema is the single source of truth: the TypeScript types are
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

import * as z from 'zod/mini'
import { roundCoordinate } from './geocoding'
import { SKIN_TYPES, type PreferredHours } from './recommendation'

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
})

export const TIER_LEVELS = Object.freeze(['anonymous', 'free', 'paid'] as const)
export type TierLevel = (typeof TIER_LEVELS)[number]

/** How to choose a start time among the feasible safe and free slots. */
export const TIME_PREFERENCES = Object.freeze(['earliest', 'latest', 'sunniest'] as const)
export type TimePreference = (typeof TIME_PREFERENCES)[number]

/** Morning notification hour: allowed range and default. */
export const NOTIFICATION_HOUR = Object.freeze({ min: 5, max: 10, default: 7 })

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

/** Trimmed text cut to `max` characters. */
function text(max: number) {
  return z.pipe(
    z.string(),
    z.transform(value => value.trim().slice(0, max)),
  )
}

/**
 * A list that keeps the elements matching `item` and drops the rest. Anything that is
 * not an array reads as an empty list. `prepare` sees each raw element with its index
 * first, to fill in values that depend on the position.
 */
function listOf<S extends z.ZodMiniType>(
  item: S,
  prepare: (raw: unknown, index: number) => unknown = raw => raw,
) {
  return z.pipe(
    z.catch(z.array(z.unknown()), []),
    z.transform(raws =>
      raws.flatMap((raw, index): z.output<S>[] => {
        const parsed = item.safeParse(prepare(raw, index))
        return parsed.success ? [parsed.data] : []
      }),
    ),
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
const stringSet = z.pipe(
  listOf(z.string().check(z.trim(), z.minLength(1))),
  z.transform(values => Array.from(new Set(values))),
)

// ---- Location ---------------------------------------------------------------------

export const LOCATION_SHAPE = {
  lat: z.pipe(z.number().check(z.gte(-90), z.lte(90)), z.transform(roundCoordinate)),
  lon: z.pipe(z.number().check(z.gte(-180), z.lte(180)), z.transform(roundCoordinate)),
  city: text(PREFS_LIMITS.placeNameLength),
  region: z.catch(text(PREFS_LIMITS.placeNameLength), ''),
  timezone: z.catch(
    z.optional(
      z.string().check(z.maxLength(PREFS_LIMITS.timezoneLength), z.regex(TIMEZONE_PATTERN)),
    ),
    undefined,
  ),
}

/** A place: coordinates rounded to 2 decimals, names trimmed and capped. */
export const LocationSchema = z.object(LOCATION_SHAPE)
export type Location = z.output<typeof LocationSchema>

/** Two places closer than the rounding grid are the same place. */
export function sameLocation(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

// ---- Profiles ---------------------------------------------------------------------

export const PROFILE_SHAPE = {
  id: z.string().check(z.refine(isNonBlank)),
  name: z.pipe(
    z.string().check(z.trim(), z.minLength(1)),
    z.transform(name => name.slice(0, PREFS_LIMITS.profileNameLength)),
  ),
  skinType: z.enum(SKIN_TYPES),
  icon: z.catch(z.optional(z.string().check(z.refine(isNonBlank))), undefined),
}

/** A person or pet whose skin type drives the safety math when selected. */
export const ProfileSchema = z.object(PROFILE_SHAPE)
export type Profile = z.output<typeof ProfileSchema>

// ---- Activities -------------------------------------------------------------------

/** Whole hours: `from` 0-23, `to` after `from` and at most 24. */
const preferredHours = z.pipe(
  z.object({ from: z.number(), to: z.number() }),
  z.transform(({ from, to }): PreferredHours => {
    const start = clamp(Math.round(from), 0, 23)
    return { from: start, to: Math.max(start + 1, Math.min(24, Math.round(to))) }
  }),
)

/** A sorted subset of 0-6 (0 = Sunday). Empty or all seven means every day: undefined. */
const daysOfWeek = z.pipe(
  z.array(z.unknown()),
  z.transform(raw => {
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
const flag = z.pipe(
  z.unknown(),
  z.transform((value): boolean | undefined => (value === true ? true : undefined)),
)

export const ACTIVITY_SHAPE = {
  id: z.string().check(z.refine(isNonBlank)),
  name: z.pipe(
    z.string(),
    z.transform(name =>
      (name.trim() || ACTIVITY_DEFAULTS.name).slice(0, PREFS_LIMITS.activityNameLength),
    ),
  ),
  icon: z.catch(z.string().check(z.refine(isNonBlank)), ACTIVITY_DEFAULTS.icon),
  durationMins: z.catch(
    z.pipe(
      z.number(),
      z.transform(mins => Math.max(5, Math.round(mins))),
    ),
    ACTIVITY_DEFAULTS.durationMins,
  ),
  /** Base max UV assuming no sunscreen. */
  maxUV: z.catch(
    z.pipe(
      z.number(),
      z.transform(uv => clamp(uv, 0, 11)),
    ),
    ACTIVITY_DEFAULTS.maxUV,
  ),
  /** Whether the recommendation assumes SPF protection. */
  sunscreen: z.catch(z.boolean(), false),
  custom: z.optional(flag),
  preferredHours: z.catch(z.optional(preferredHours), undefined),
  /** Default 'earliest', stored as undefined. */
  timePreference: z.catch(
    z.optional(
      z.pipe(
        z.enum(TIME_PREFERENCES),
        z.transform((value): TimePreference | undefined =>
          value === 'earliest' ? undefined : value,
        ),
      ),
    ),
    undefined,
  ),
  daysOfWeek: z.catch(z.optional(daysOfWeek), undefined),
  /** Discount effective UV by cloud cover when planning. */
  cloudSensitive: z.optional(flag),
}

export const ActivitySchema = z.pipe(
  z.object(ACTIVITY_SHAPE),
  z.transform(activity => {
    // Custom activities predate the `custom` flag; their ids carry the marker.
    if (activity.id.startsWith('custom_')) activity.custom = true
    return activity
  }),
)
export type Activity = z.output<typeof ActivitySchema>

// ---- The document -----------------------------------------------------------------

const calendarHours = z.pipe(
  z.object({ from: z.number(), to: z.number() }),
  z.transform(({ from, to }) => ({
    from: clamp(from, CALENDAR_HOUR_BOUNDS.from.min, CALENDAR_HOUR_BOUNDS.from.max),
    to: clamp(to, CALENDAR_HOUR_BOUNDS.to.min, CALENDAR_HOUR_BOUNDS.to.max),
  })),
)

const upgradeInterest = z.object({
  email: z.catch(
    z.optional(
      z.pipe(
        z.string().check(z.trim(), z.minLength(1)),
        z.transform(email => email.slice(0, PREFS_LIMITS.emailLength)),
      ),
    ),
    undefined,
  ),
  createdAt: z.string().check(
    z.maxLength(PREFS_LIMITS.timestampLength),
    z.refine(value => Number.isFinite(Date.parse(value))),
  ),
})

export const PREFERENCES_SHAPE = {
  uid: z.catch(z.string(), ''),
  /** Set by `parsePreferences`; see the versioning note at the top of this file. */
  schemaVersion: z.catch(z.int().check(z.gte(1)), PREFS_SCHEMA_VERSION),
  /** The active location. */
  location: LocationSchema,
  /**
   * Quick-switch shortcuts, deduplicated by position and capped. The active location is
   * pinned separately in the UI, so changing it is never gated; only saving extras is.
   */
  savedLocations: z.pipe(
    listOf(LocationSchema),
    z.transform(list => uniqueBy(list, sameLocation).slice(0, PREFS_LIMITS.savedLocations)),
  ),
  /** The live skin type used for all safety math (the active profile's). */
  skinType: z.catch(z.enum(SKIN_TYPES), 'fair'),
  /** Saved people and pets, unique by id; undefined when there are none. */
  profiles: z.optional(
    z.pipe(
      listOf(ProfileSchema, withDefaultId('profile_')),
      z.transform(list => {
        const unique = uniqueBy(list, (a, b) => a.id === b.id).slice(0, PREFS_LIMITS.profiles)
        return unique.length ? unique : undefined
      }),
    ),
  ),
  /** Kept only while it names one of `profiles`. */
  activeProfileId: z.catch(z.optional(z.string()), undefined),
  /** Legacy global sunscreen flag; activities carry their own since version 2. */
  sunscreen: z.catch(z.boolean(), false),
  activities: z.pipe(
    listOf(ActivitySchema, withDefaultId('migrated_')),
    z.transform(list => list.slice(0, PREFS_LIMITS.activities)),
  ),
  /** Written by the server after account creation. */
  tier: z.catch(z.enum(TIER_LEVELS), 'anonymous'),
  onboardingComplete: z.catch(z.boolean(), false),
  calendarHours: z.catch(z.optional(calendarHours), undefined),
  /** Sun-path arc on the dashboard; default on. */
  showSunPath: z.catch(z.optional(z.boolean()), undefined),
  hiddenActivitySuggestionIds: stringSet,
  collapsedActivityCategories: stringSet,
  upgradeInterest: z.catch(z.optional(upgradeInterest), undefined),
  notificationHour: z.catch(
    z.pipe(
      z.number(),
      z.transform(hour => clamp(Math.round(hour), NOTIFICATION_HOUR.min, NOTIFICATION_HOUR.max)),
    ),
    NOTIFICATION_HOUR.default,
  ),
}

const DocumentSchema = z.object(PREFERENCES_SHAPE)

export const PreferencesSchema = z.pipe(
  DocumentSchema,
  z.transform((prefs: z.output<typeof DocumentSchema>) => {
    if (!prefs.profiles?.some(profile => profile.id === prefs.activeProfileId)) {
      delete prefs.activeProfileId
    }
    return prefs
  }),
)

export type UserPreferences = z.output<typeof PreferencesSchema>
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
  const location = LocationSchema.safeParse(doc.location).success ? doc.location : fallbackLocation
  const parsed = PreferencesSchema.safeParse({ ...doc, location })
  if (!parsed.success) return null
  parsed.data.schemaVersion = Math.max(stored, PREFS_SCHEMA_VERSION)
  return parsed.data
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
