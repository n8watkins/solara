import { readFileSync } from 'node:fs'
import {
  ACTIVITY_SHAPE,
  CALENDAR_HOUR_BOUNDS,
  CLIENT_PREFERENCE_FIELDS,
  CLOCK_FORMAT_PREFERENCES,
  LOCATION_SHAPE,
  NOTIFICATION_HOUR,
  PREFS_LIMITS,
  PREFS_SCHEMA_VERSION,
  PROFILE_SHAPE,
  SERVER_OWNED_FIELDS,
  SKIN_TYPES,
  TEMPERATURE_UNIT_PREFERENCES,
  TIER_LEVELS,
} from '@solara/core'
import { describe, expect, it } from 'vitest'
import { defaultPrefs, newAccountPrefs, normalizePrefs } from './prefs'
import { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES, TIER_LIMITS } from './tiers'

// firestore.rules cannot import the preferences schema (packages/core/src/prefs.ts), so it
// repeats the key lists, caps and enums by hand. These tests read them back out of the
// rules and compare them with the schema, so the two cannot drift apart silently.
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

/** The source of `function name(...) { ... }` in firestore.rules. */
function rulesFunction(name: string): string {
  const start = rules.search(new RegExp(`function ${name}\\(`))
  if (start < 0) throw new Error(`${name} not found in firestore.rules`)
  const open = rules.indexOf('{', start)
  let depth = 0
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === '{') depth++
    if (rules[i] === '}' && --depth === 0) return rules.slice(start, i + 1)
  }
  throw new Error(`${name} is not closed in firestore.rules`)
}

/** The quoted strings of the first list literal after `marker` in `source`. */
function listAfter(source: string, marker: string): string[] {
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`${marker} not found`)
  const list = /\[([^\]]*)\]/.exec(source.slice(at))
  if (!list?.[1]) throw new Error(`no list after ${marker}`)
  return [...list[1].matchAll(/'([^']*)'/g)].map(m => m[1] ?? '')
}

/** The number in the first match of `pattern` (which has one capture group). */
function numberIn(source: string, pattern: RegExp): number {
  const match = pattern.exec(source)
  if (!match?.[1]) throw new Error(`${pattern} not found`)
  return Number(match[1])
}

function rulesList(functionName: string): string[] {
  return listAfter(rulesFunction(functionName), 'return [')
}

const sorted = (values: readonly string[]) => [...values].sort()

describe('firestore.rules preset lists', () => {
  it('lists exactly the preset activity ids', () => {
    expect(rulesList('presetActivityIds').sort()).toEqual(PRESET_ACTIVITIES.map(a => a.id).sort())
  })

  it('lists exactly the activity category names', () => {
    expect(rulesList('activityCategoryNames').sort()).toEqual(
      ACTIVITY_CATEGORIES.map(c => c.name).sort(),
    )
  })
})

describe('firestore.rules match the preferences schema', () => {
  const preferences = rulesFunction('validPreferences')

  it('lets clients write exactly the schema fields the server does not own', () => {
    expect(sorted(rulesList('preferenceKeys'))).toEqual(sorted(CLIENT_PREFERENCE_FIELDS))
    const newUser = rulesFunction('validNewUser')
    expect(sorted(listAfter(newUser, 'keys.removeAll('))).toEqual(sorted(SERVER_OWNED_FIELDS))
  })

  it('creates accounts with the fields and tiers the rules require', () => {
    const newUser = rulesFunction('validNewUser')
    const fresh = newAccountPrefs('uid', defaultPrefs({ lat: 1, lon: 2, city: 'c', region: '' }))!
    expect(Object.keys(fresh)).toEqual(expect.arrayContaining(listAfter(newUser, 'hasAll(')))
    expect(listAfter(newUser, 'data.tier in')).toContain(fresh.tier)
    for (const tier of listAfter(newUser, 'data.tier in')) expect(TIER_LEVELS).toContain(tier)
    expect(listAfter(rulesFunction('validUserUpdate'), 'removedKeys().hasOnly(')).toEqual([
      'calendarFeedToken',
    ])
  })

  it('accepts every skin type, and only those', () => {
    expect(sorted(listAfter(preferences, 'data.skinType in'))).toEqual(sorted(SKIN_TYPES))
  })

  it('accepts every display unit choice, and only those', () => {
    expect(sorted(listAfter(preferences, 'data.temperatureUnit in'))).toEqual(
      sorted(TEMPERATURE_UNIT_PREFERENCES),
    )
    expect(sorted(listAfter(preferences, 'data.clockFormat in'))).toEqual(
      sorted(CLOCK_FORMAT_PREFERENCES),
    )
  })

  it('accepts the current schema version and the allowed hours', () => {
    expect(numberIn(preferences, /schemaVersion >= (\d+)/)).toBeLessThanOrEqual(1)
    expect(numberIn(preferences, /schemaVersion <= (\d+)/)).toBeGreaterThanOrEqual(
      PREFS_SCHEMA_VERSION,
    )
    expect(numberIn(preferences, /notificationHour >= (\d+)/)).toBeLessThanOrEqual(
      NOTIFICATION_HOUR.min,
    )
    expect(numberIn(preferences, /notificationHour <= (\d+)/)).toBeGreaterThanOrEqual(
      NOTIFICATION_HOUR.max,
    )
    const hours = rulesFunction('validCalendarHours')
    expect(numberIn(hours, /hours\.from >= (\d+)/)).toBe(CALENDAR_HOUR_BOUNDS.from.min)
    expect(numberIn(hours, /hours\.from <= (\d+)/)).toBe(CALENDAR_HOUR_BOUNDS.from.max)
    expect(numberIn(hours, /hours\.to >= (\d+)/)).toBe(CALENDAR_HOUR_BOUNDS.to.min)
    expect(numberIn(hours, /hours\.to <= (\d+)/)).toBe(CALENDAR_HOUR_BOUNDS.to.max)
    expect(numberIn(preferences, /activeProfileId\.size\(\) <= (\d+)/)).toBe(
      PREFS_LIMITS.activeProfileIdLength,
    )
  })

  it('checks locations with the schema keys and caps', () => {
    const location = rulesFunction('validLocation')
    const keys = Object.keys(LOCATION_SHAPE)
    expect(sorted(listAfter(location, 'hasOnly('))).toEqual(sorted(keys))
    expect(sorted(listAfter(location, 'hasAll('))).toEqual(
      sorted(keys.filter(k => k !== 'timezone')),
    )
    expect(numberIn(location, /city\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.placeNameLength)
    expect(numberIn(location, /region\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.placeNameLength)
    expect(numberIn(location, /timezone\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.timezoneLength)

    const saved = rulesFunction('validSavedLocations')
    expect(sorted(listAfter(saved, 'let k ='))).toEqual(sorted(keys))
    expect(numberIn(saved, /n <= (\d+)/)).toBe(PREFS_LIMITS.savedLocations)
    expect(saved.match(/validSavedLocation\(list\[\d+\]/g)).toHaveLength(
      PREFS_LIMITS.savedLocations,
    )
    const one = rulesFunction('validSavedLocation')
    expect(numberIn(one, /city\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.placeNameLength)
    expect(numberIn(one, /region\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.placeNameLength)
  })

  it('checks profiles with the schema keys and caps', () => {
    const profiles = rulesFunction('validProfiles')
    expect(sorted(listAfter(profiles, 'let k ='))).toEqual(sorted(Object.keys(PROFILE_SHAPE)))
    expect(numberIn(profiles, /n <= (\d+)/)).toBe(PREFS_LIMITS.profiles)
    expect(profiles.match(/validProfile\(list\[\d+\]/g)).toHaveLength(PREFS_LIMITS.profiles)
    expect(numberIn(rulesFunction('validProfile'), /name\.size\(\) <= (\d+)/)).toBe(
      PREFS_LIMITS.profileNameLength,
    )
  })

  it('checks activities with the schema keys and caps', () => {
    const activities = rulesFunction('validActivities')
    expect(sorted(listAfter(activities, 'let k ='))).toEqual(sorted(Object.keys(ACTIVITY_SHAPE)))
    expect(numberIn(activities, /n <= (\d+)/)).toBe(PREFS_LIMITS.activities)
    const block = rulesFunction('validActivityBlock')
    const perBlock = block.match(/validActivity\(list\[start/g)?.length ?? 0
    const blocks = activities.match(/validActivityBlock\(list, k, n, \d+\)/g)?.length ?? 0
    expect(perBlock * blocks).toBeGreaterThanOrEqual(PREFS_LIMITS.activities)
    expect(numberIn(rulesFunction('validActivity'), /name\.size\(\) <= (\d+)/)).toBe(
      PREFS_LIMITS.activityNameLength,
    )
  })

  it('checks the upgrade interest with the schema caps', () => {
    const interest = rulesFunction('validUpgradeInterest')
    expect(sorted(listAfter(interest, 'hasOnly('))).toEqual(['createdAt', 'email'])
    expect(numberIn(interest, /createdAt\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.timestampLength)
    expect(numberIn(interest, /email\.size\(\) <= (\d+)/)).toBe(PREFS_LIMITS.emailLength)
  })

  it('caps the tiers no higher than the rules allow', () => {
    expect(TIER_LIMITS.paid.activities).toBe(PREFS_LIMITS.activities)
    expect(TIER_LIMITS.paid.savedLocations).toBe(PREFS_LIMITS.savedLocations)
    expect(TIER_LIMITS.paid.profiles).toBeLessThanOrEqual(PREFS_LIMITS.profiles)
  })

  it('normalizes a document to keys the rules allow', () => {
    const prefs = normalizePrefs({
      location: { lat: 1, lon: 2, city: 'c', region: 'r', timezone: 'UTC' },
      savedLocations: [{ lat: 1, lon: 2, city: 'c', region: 'r', timezone: 'UTC' }],
      profiles: [{ id: 'p', name: 'P', skinType: 'fair', icon: '🙂' }],
      activities: [
        {
          id: 'custom_1',
          name: 'A',
          icon: '🏃',
          durationMins: 30,
          maxUV: 3,
          sunscreen: true,
          preferredHours: { from: 6, to: 9 },
          timePreference: 'latest',
          daysOfWeek: [1],
          cloudSensitive: true,
        },
      ],
      calendarHours: { from: 6, to: 20 },
      upgradeInterest: { email: 'a@b.co', createdAt: '2026-05-01T12:00:00.000Z' },
    })!
    expect(sorted(Object.keys(prefs.location))).toEqual(sorted(Object.keys(LOCATION_SHAPE)))
    expect(sorted(Object.keys(prefs.profiles![0]!))).toEqual(sorted(Object.keys(PROFILE_SHAPE)))
    expect(sorted(Object.keys(prefs.activities[0]!))).toEqual(sorted(Object.keys(ACTIVITY_SHAPE)))
  })
})
