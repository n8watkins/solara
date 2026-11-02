// Whether a plan read from this browser is already exactly what reading it through the
// preferences schema (normalizePrefs in lib/prefs.ts) would give: the form the app
// writes, for a guest's plan (lib/guest.ts saveGuestPrefs, after asGuestPrefs) and for a
// signed-in account's copy (lib/local-prefs.ts saveLocalPrefs).
//
// It lets the opening screen read the plan without the schema: Valibot and the
// preferences schema load on demand, and only when this check says no (an older plan, or
// one changed outside the app), so they stay out of a guest's first load, and an
// account's copy still opens offline from the app shell's precached scripts (ROADMAP item
// 52). It is a strict check, not a second parser: it never repairs anything, and whatever
// it accepts the schema would return unchanged, while anything else still goes through
// the schema exactly as before. stored-plan.test.ts holds it to that against the schema
// itself, so a field added to the schema but not here only sends plans down the schema's
// path; it can never let an unchecked value through.

import { isPlainRecord } from '@solara/core/plain-record'
import { roundCoordinate } from '@solara/core/coordinates'
import { SHADE_LEVELS, SURFACES } from '@solara/core/exposure'
import {
  TIER_LEVELS,
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

const isIcon: Check = icon =>
  typeof icon === 'string' && icon.trim().length > 0 && icon.length <= PREFS_LIMITS.iconLength

const isActivity: Check = value =>
  shaped(
    value,
    {
      id: id => typeof id === 'string' && id.trim().length > 0,
      name: text(PREFS_LIMITS.activityNameLength, 1),
      icon: isIcon,
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

/** Places, none within the rounding grid of another (the schema keeps the first). */
const isPlaces: Check = value =>
  Array.isArray(value) &&
  value.length <= PREFS_LIMITS.savedLocations &&
  value.every(
    (place, i) =>
      isLocation(place) &&
      value
        .slice(0, i)
        .every(
          other =>
            Math.abs(other.lat - place.lat) >= 0.01 || Math.abs(other.lon - place.lon) >= 0.01,
        ),
  )

/** Distinct, non-blank ids of at most `max` characters. */
const ids =
  (max: number): Check =>
  value =>
    Array.isArray(value) &&
    value.length <= PREFS_LIMITS.profiles &&
    new Set(value).size === value.length &&
    value.every(id => typeof id === 'string' && id.trim().length > 0 && id.length <= max)

const isProfiles: Check = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  ids(Infinity)(value.map(profile => (profile as { id?: unknown } | null)?.id)) &&
  value.every(profile =>
    shaped(
      profile,
      {
        id: () => true,
        name: text(PREFS_LIMITS.profileNameLength, 1),
        skinType: oneOf(SKIN_TYPES),
      },
      { icon: isIcon },
    ),
  )

const REQUIRED: Record<string, Check> = {
  uid: value => typeof value === 'string',
  schemaVersion: value => value === PREFS_SCHEMA_VERSION,
  location: isLocation,
  savedLocations: isPlaces,
  skinType: oneOf(SKIN_TYPES),
  sunscreen: isBoolean,
  activities: value =>
    Array.isArray(value) && value.length <= PREFS_LIMITS.activities && value.every(isActivity),
  tier: oneOf(TIER_LEVELS),
  onboardingComplete: isBoolean,
  hiddenActivitySuggestionIds: knownSet(PRESET_IDS),
  collapsedActivityCategories: knownSet(CATEGORY_NAMES),
  notificationHour: integerIn(NOTIFICATION_HOUR.min, NOTIFICATION_HOUR.max),
}

const OPTIONAL: Record<string, Check> = {
  profiles: isProfiles,
  // Kept only while it names one of the profiles (checked in isStoredPlan).
  activeProfileId: value => typeof value === 'string',
  groupMode: isBoolean,
  groupProfileIds: ids(PREFS_LIMITS.activeProfileIdLength),
  upgradeInterest: value =>
    shaped(
      value,
      {
        createdAt: at =>
          typeof at === 'string' &&
          at.length <= PREFS_LIMITS.timestampLength &&
          Number.isFinite(Date.parse(at)),
      },
      { email: text(PREFS_LIMITS.emailLength, 1) },
    ),
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
 * Whether `raw` (a plan as stored, parsed from JSON) is already in the exact form the
 * preferences schema gives it, so it can be used as it is. False sends it through the
 * schema (lib/prefs.ts).
 */
export function isStoredPlan(raw: unknown): raw is UserPreferences {
  if (!shaped(raw, REQUIRED, OPTIONAL)) return false
  const { activeProfileId, profiles } = raw as Partial<UserPreferences>
  return activeProfileId === undefined || !!profiles?.some(p => p.id === activeProfileId)
}

/** The fields a guest plan never has (asGuestPrefs in lib/guest.ts). */
const ACCOUNT_ONLY = [
  'profiles',
  'activeProfileId',
  'groupMode',
  'groupProfileIds',
  'upgradeInterest',
]

/** isStoredPlan for a guest's plan, which is also on the guest tier and within its limits. */
export function isStoredGuestPlan(raw: unknown): raw is UserPreferences {
  return (
    isStoredPlan(raw) &&
    raw.uid === '' &&
    raw.tier === 'anonymous' &&
    raw.savedLocations.length === 0 &&
    raw.activities.length <= TIER_LIMITS.anonymous.activities &&
    ACCOUNT_ONLY.every(field => !(field in raw))
  )
}
