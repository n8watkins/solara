// Whether a guest plan read from this browser is already exactly what reading it would
// give: the form saveGuestPrefs (lib/guest.ts) writes after the plan went through the
// preferences schema (normalizePrefs in lib/prefs.ts, then asGuestPrefs).
//
// It lets a returning guest's dashboard read the plan without the schema: Valibot and
// the preferences schema load on demand, and only when this check says no (an older
// plan, or one changed outside the app), so they stay out of a guest's first load
// (ROADMAP item 52). It is a strict check, not a second parser: it never repairs
// anything, and whatever it accepts the schema would return unchanged, while anything
// else still goes through the schema exactly as before. stored-guest-plan.test.ts holds
// it to that against the schema itself, so a field added to the schema but not here only
// sends plans down the schema's path; it can never let an unchecked value through.

import { isPlainRecord } from '@solara/core/plain-record'
import { roundCoordinate } from '@solara/core/coordinates'
import { SHADE_LEVELS, SURFACES } from '@solara/core/exposure'
import {
  CALENDAR_HOUR_BOUNDS,
  CLOCK_FORMAT_PREFERENCES,
  DEVICE_LANGUAGES,
  FEELS_LIKE_LIMITS,
  LANGUAGE_PREFERENCES,
  NOTIFICATION_HOUR,
  PLACE_TIMEZONE_PATTERN,
  PREFS_LIMITS,
  PREFS_SCHEMA_VERSION,
  QUIET_HOURS,
  TEMPERATURE_UNIT_PREFERENCES,
  UV_ALERT_THRESHOLD,
} from '@solara/core/prefs-rules'
import { SKIN_TYPES } from '@solara/core/recommendation'
import { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES, TIER_LIMITS } from '@solara/core/tiers'
import type { UserPreferences } from './types'

type Check = (value: unknown) => boolean

const isBoolean: Check = value => typeof value === 'boolean'
const isTrue: Check = value => value === true
const oneOf =
  (choices: readonly unknown[]): Check =>
  value =>
    choices.includes(value)
const integerIn =
  (min: number, max: number): Check =>
  value =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max
const numberIn =
  (min: number, max: number): Check =>
  value =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
/** Text the schema would keep as it is: trimmed, and `min` to `max` characters. */
const text =
  (max: number, min = 0): Check =>
  value =>
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= min &&
    value.length <= max

/** A plain object with every `required` field valid and no field outside both lists. */
function shaped(
  value: unknown,
  required: Record<string, Check>,
  optional: Record<string, Check> = {},
): boolean {
  if (!isPlainRecord(value)) return false
  for (const key in required) if (!Object.hasOwn(value, key)) return false
  for (const [key, field] of Object.entries(value)) {
    const check = Object.hasOwn(required, key)
      ? required[key]
      : Object.hasOwn(optional, key)
        ? optional[key]
        : null
    if (!check?.(field)) return false
  }
  return true
}

const coordinate =
  (limit: number): Check =>
  value =>
    numberIn(-limit, limit)(value) && roundCoordinate(value as number) === value

const isLocation: Check = value =>
  shaped(
    value,
    {
      lat: coordinate(90),
      lon: coordinate(180),
      city: text(PREFS_LIMITS.placeNameLength),
      region: text(PREFS_LIMITS.placeNameLength),
    },
    {
      timezone: zone =>
        typeof zone === 'string' &&
        zone.length <= PREFS_LIMITS.timezoneLength &&
        PLACE_TIMEZONE_PATTERN.test(zone),
    },
  )

/** Two whole hours, `from` 0-23 and `to` after it, at most 24. */
const isPreferredHours: Check = value =>
  shaped(value, { from: integerIn(0, 23), to: integerIn(1, 24) }) &&
  (value as { from: number; to: number }).to > (value as { from: number; to: number }).from

/** Some days of the week (0-6), ascending, neither none nor all seven. */
const isDays: Check = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length < 7 &&
  value.every((day, i) => integerIn(0, 6)(day) && (i === 0 || day > value[i - 1]))

const isFeelsLike: Check = value =>
  value === null ||
  (numberIn(FEELS_LIKE_LIMITS.min, FEELS_LIKE_LIMITS.max)(value) &&
    Math.round((value as number) * 10) / 10 === value)

const isActivity: Check = value =>
  shaped(
    value,
    {
      id: id => typeof id === 'string' && id.trim().length > 0,
      name: text(PREFS_LIMITS.activityNameLength, 1),
      icon: icon =>
        typeof icon === 'string' &&
        icon.trim().length > 0 &&
        icon.length <= PREFS_LIMITS.iconLength,
      durationMins: mins => Number.isInteger(mins) && (mins as number) >= 5,
      maxUV: numberIn(0, 11),
      sunscreen: isBoolean,
    },
    {
      custom: isTrue,
      preferredHours: isPreferredHours,
      timePreference: oneOf(['latest', 'sunniest']),
      daysOfWeek: isDays,
      cloudSensitive: isTrue,
      shade: oneOf(SHADE_LEVELS),
      surface: oneOf(SURFACES),
      avoidRain: isBoolean,
      maxFeelsLikeC: isFeelsLike,
    },
  ) &&
  // The schema marks custom activities saved before the flag existed by their id.
  (!(value as { id: string }).id.startsWith('custom_') ||
    (value as { custom?: true }).custom === true)

/** Distinct names the app knows, each as the schema keeps it. */
const knownSet =
  (known: ReadonlySet<string>): Check =>
  value =>
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every(item => text(Infinity, 1)(item) && known.has(item as string))

const PRESET_IDS = new Set(PRESET_ACTIVITIES.map(preset => preset.id))
const CATEGORY_NAMES = new Set(ACTIVITY_CATEGORIES.map(category => category.name))

const REQUIRED: Record<string, Check> = {
  uid: value => value === '',
  schemaVersion: value => value === PREFS_SCHEMA_VERSION,
  location: isLocation,
  savedLocations: value => Array.isArray(value) && value.length === 0,
  skinType: oneOf(SKIN_TYPES),
  sunscreen: isBoolean,
  activities: value =>
    Array.isArray(value) &&
    value.length <= TIER_LIMITS.anonymous.activities &&
    value.every(isActivity),
  tier: value => value === 'anonymous',
  onboardingComplete: isBoolean,
  hiddenActivitySuggestionIds: knownSet(PRESET_IDS),
  collapsedActivityCategories: knownSet(CATEGORY_NAMES),
  notificationHour: integerIn(NOTIFICATION_HOUR.min, NOTIFICATION_HOUR.max),
}

// A guest plan never has profiles, saved places or an upgrade request (asGuestPrefs).
const OPTIONAL: Record<string, Check> = {
  calendarHours: value =>
    shaped(value, {
      from: numberIn(CALENDAR_HOUR_BOUNDS.from.min, CALENDAR_HOUR_BOUNDS.from.max),
      to: numberIn(CALENDAR_HOUR_BOUNDS.to.min, CALENDAR_HOUR_BOUNDS.to.max),
    }),
  showSunPath: isBoolean,
  uvAlertThreshold: integerIn(UV_ALERT_THRESHOLD.off, UV_ALERT_THRESHOLD.max),
  quietHours: value =>
    shaped(value, {
      from: integerIn(QUIET_HOURS.min, QUIET_HOURS.max),
      to: integerIn(QUIET_HOURS.min, QUIET_HOURS.max),
    }),
  eventHeadsUp: isBoolean,
  dailyUv: isBoolean,
  temperatureUnit: oneOf(TEMPERATURE_UNIT_PREFERENCES),
  clockFormat: oneOf(CLOCK_FORMAT_PREFERENCES),
  language: oneOf(LANGUAGE_PREFERENCES),
  deviceLanguage: oneOf(DEVICE_LANGUAGES),
}

/**
 * Whether `raw` (a guest plan as stored, parsed from JSON) is already in the exact form
 * the preferences schema gives it, so it can be used as it is. False sends it through
 * the schema (lib/guest.ts loadGuestPrefs).
 */
export function isStoredGuestPlan(raw: unknown): raw is UserPreferences {
  return shaped(raw, REQUIRED, OPTIONAL)
}
