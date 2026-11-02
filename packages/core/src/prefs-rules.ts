// The limits, choices and version rules of the preferences document (./prefs.ts), apart
// from its Valibot schema, so code that runs on a guest's first screen (the stored guest
// plan check in the web app, lib/stored-plan.ts) can use them without Valibot
// (ROADMAP item 52). ./prefs.ts re-exports all of it.

import m from './messages/core'

/** The document shape this code reads and writes. Bump it with a new MIGRATIONS entry. */
export const PREFS_SCHEMA_VERSION = 2

/**
 * Storage caps, mirrored by firestore.rules. The list caps are Pro's (TIER_LIMITS.paid in
 * tiers.ts, checked by tiers.test.ts); they are written out here because importing
 * tiers.ts would tie the plan data into every bundle that parses preferences.
 */
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

/**
 * The language (ROADMAP item 46): 'auto' (or a missing field) follows the device's
 * language; otherwise one of i18n.ts LOCALES. Added without a version bump, like the units.
 */
export const LANGUAGE_PREFERENCES = Object.freeze(['auto', 'en', 'es'] as const)
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]
/**
 * The languages a device's language is kept as (`deviceLanguage`): the choices other
 * than Automatic, which are i18n.ts LOCALES (prefs.test.ts checks). Listed here rather
 * than imported, so the preferences code does not pull the catalogue code into a chunk.
 */
export const DEVICE_LANGUAGES = Object.freeze(['en', 'es'] as const)

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

/** The feels-like limits an activity may set, in Celsius (about 59-122°F). */
export const FEELS_LIKE_LIMITS = Object.freeze({ min: 15, max: 50 })

/** A place's IANA time zone, as stored (`UTC` or `Area/Location`). */
export const PLACE_TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/

/** False for preferences read from a newer schema version: writing them would lose data. */
export function isWritablePreferences(prefs: { schemaVersion: number }): boolean {
  return prefs.schemaVersion <= PREFS_SCHEMA_VERSION
}

export class NewerPreferencesVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(m.newerSettings(schemaVersion))
    this.name = 'NewerPreferencesVersionError'
  }
}
