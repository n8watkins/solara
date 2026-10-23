import { describe, expect, it } from 'vitest'
import {
  CLIENT_PREFERENCE_FIELDS,
  clientPreferencesUpdate,
  isWritablePreferences,
  MIGRATIONS,
  NewerPreferencesVersionError,
  parsePreferences,
  PREFERENCE_FIELDS,
  PREFS_LIMITS,
  PREFS_SCHEMA_VERSION,
  storedSchemaVersion,
  type UserPreferences,
} from '@solara/core'

// Documents as each past client version wrote them (shapes from git history), plus what
// production documents carry today. Every one must load, and loading must be a fixed point.

/** 2f02b3c (initial app): no schemaVersion, tier or onboarding flag; one global sunscreen flag. */
const V1_INITIAL = {
  uid: 'u1',
  location: { lat: 34.052235, lon: -118.243683, city: 'Los Angeles', region: 'CA' },
  skinType: 'medium',
  sunscreen: true,
  activities: [{ id: 'run', name: 'Run', icon: '🏃', durationMins: 45, maxUV: 5 }],
}

/** e38dea7 (tiers and onboarding): still no schemaVersion; custom activities. */
const V1_TIERS = {
  uid: 'u2',
  location: { lat: 47.6062, lon: -122.3321, city: 'Seattle', region: 'WA' },
  skinType: 'very-fair',
  sunscreen: false,
  activities: [
    { id: 'custom_1712345', name: 'Kite surfing', icon: '🪁', durationMins: 90, maxUV: 6 },
    { id: 'walk', name: 'Walk', icon: '🚶', durationMins: 30, maxUV: 4, sunscreen: true },
  ],
  tier: 'free',
  onboardingComplete: true,
}

/** 7a0d9be (schemaVersion 2): per-activity sunscreen; `...raw` let stray fields through. */
const V2_EARLY = {
  uid: 'u3',
  schemaVersion: 2,
  location: { lat: 40.7128, lon: -74.006, city: 'New York', region: 'NY' },
  skinType: 'olive',
  sunscreen: true,
  activities: [
    { id: 'swim', name: 'Swim', icon: '🏊', durationMins: 60, maxUV: 3, sunscreen: false },
  ],
  tier: 'paid',
  onboardingComplete: true,
  calendarHours: { from: 7, to: 21 },
  upgradeInterest: { email: ' me@example.com ', createdAt: '2026-05-01T12:00:00.000Z' },
  strayField: 'left by the old spread',
}

const activity = (i: number) => ({
  id: `custom_${i}`,
  name: `Activity ${i}`,
  icon: '🏃',
  durationMins: 30,
  maxUV: 3,
  sunscreen: false,
})

/** A production document today: every feature, legacy fields and server-owned fields. */
const V2_PRODUCTION = {
  uid: 'u4',
  schemaVersion: 2,
  location: {
    lat: 32.715736,
    lon: -117.161087,
    city: '  San Diego  ',
    region: 'California',
    timezone: 'America/Los_Angeles',
  },
  savedLocations: [
    { lat: 32.715736, lon: -117.161087, city: 'San Diego', region: 'California' },
    { lat: 32.7157, lon: -117.1611, city: 'San Diego again', region: 'California' },
    { lat: 21.306944, lon: -157.858337, city: 'Honolulu', region: 'Hawaii' },
  ],
  skinType: 'fair',
  profiles: [
    { id: 'me', name: 'Me', skinType: 'fair', icon: '🧑' },
    { id: 'kid', name: 'Maya', skinType: 'very-fair', icon: '🧒' },
  ],
  activeProfileId: 'kid',
  sunscreen: false,
  activities: [
    {
      id: 'run',
      name: 'Morning run',
      icon: '🏃',
      durationMins: 45,
      maxUV: 4,
      sunscreen: true,
      preferredHours: { from: 6, to: 10 },
      timePreference: 'earliest',
      daysOfWeek: [1, 2, 3, 4, 5],
      cloudSensitive: true,
    },
    ...Array.from({ length: 24 }, (_, i) => activity(i)),
  ],
  tier: 'paid',
  onboardingComplete: true,
  calendarHours: { from: 6, to: 20 },
  showSunPath: false,
  hiddenActivitySuggestionIds: ['golf', 'golf'],
  collapsedActivityCategories: ['Water sports'],
  notificationHour: 8,
  // Retired client-minted feed token; the server migrates it out (functions/src/feed/tokens.ts).
  calendarFeedToken: 'a'.repeat(40),
  // Server-owned fields.
  stripeCustomerId: 'cus_123',
  stripeCheckoutSessionId: 'cs_123',
  stripeCheckoutStatus: 'succeeded',
  notificationDeliveryKey: '2026-10-22',
}

const DEFAULTS = {
  savedLocations: [],
  hiddenActivitySuggestionIds: [],
  collapsedActivityCategories: [],
  notificationHour: 7,
}

describe('parsePreferences: migrations from every past shape', () => {
  it('v1 (initial): copies the global sunscreen flag onto each activity and fills defaults', () => {
    expect(parsePreferences(V1_INITIAL)).toEqual({
      ...DEFAULTS,
      uid: 'u1',
      schemaVersion: PREFS_SCHEMA_VERSION,
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' },
      skinType: 'medium',
      sunscreen: true,
      activities: [
        { id: 'run', name: 'Run', icon: '🏃', durationMins: 45, maxUV: 5, sunscreen: true },
      ],
      tier: 'anonymous',
      onboardingComplete: false,
    })
  })

  it('v1 (tiers): keeps an explicit per-activity flag and marks custom activities', () => {
    const prefs = parsePreferences(V1_TIERS)!
    expect(prefs.schemaVersion).toBe(PREFS_SCHEMA_VERSION)
    expect(prefs.tier).toBe('free')
    expect(prefs.onboardingComplete).toBe(true)
    expect(prefs.activities).toEqual([
      {
        id: 'custom_1712345',
        name: 'Kite surfing',
        icon: '🪁',
        durationMins: 90,
        maxUV: 6,
        sunscreen: false,
        custom: true,
      },
      { id: 'walk', name: 'Walk', icon: '🚶', durationMins: 30, maxUV: 4, sunscreen: true },
    ])
  })

  it('v2 (early): drops stray fields and normalizes the upgrade interest', () => {
    const prefs = parsePreferences(V2_EARLY)!
    expect(prefs).not.toHaveProperty('strayField')
    expect(prefs.activities[0]?.sunscreen).toBe(false)
    expect(prefs.calendarHours).toEqual({ from: 7, to: 21 })
    expect(prefs.upgradeInterest).toEqual({
      email: 'me@example.com',
      createdAt: '2026-05-01T12:00:00.000Z',
    })
    expect(prefs.location).toEqual({ lat: 40.71, lon: -74.01, city: 'New York', region: 'NY' })
  })

  it('v2 (production): rounds coordinates, caps lists and drops legacy and server fields', () => {
    const prefs = parsePreferences(V2_PRODUCTION)!
    expect(prefs.location).toEqual({
      lat: 32.72,
      lon: -117.16,
      city: 'San Diego',
      region: 'California',
      timezone: 'America/Los_Angeles',
    })
    // The second shortcut rounds onto the first one.
    expect(prefs.savedLocations.map(l => [l.city, l.lat, l.lon])).toEqual([
      ['San Diego', 32.72, -117.16],
      ['Honolulu', 21.31, -157.86],
    ])
    expect(prefs.activities).toHaveLength(PREFS_LIMITS.activities)
    expect(prefs.activities[0]).toEqual({
      id: 'run',
      name: 'Morning run',
      icon: '🏃',
      durationMins: 45,
      maxUV: 4,
      sunscreen: true,
      preferredHours: { from: 6, to: 10 },
      daysOfWeek: [1, 2, 3, 4, 5],
      cloudSensitive: true,
    })
    expect(prefs.activeProfileId).toBe('kid')
    expect(prefs.hiddenActivitySuggestionIds).toEqual(['golf'])
    expect(prefs.notificationHour).toBe(8)
    expect(prefs.showSunPath).toBe(false)
    for (const field of [
      'calendarFeedToken',
      'stripeCustomerId',
      'stripeCheckoutSessionId',
      'stripeCheckoutStatus',
      'notificationDeliveryKey',
    ]) {
      expect(prefs).not.toHaveProperty(field)
    }
    expect(Object.keys(prefs).every(key => (PREFERENCE_FIELDS as string[]).includes(key))).toBe(
      true,
    )
  })

  it.each([
    ['v1 initial', V1_INITIAL],
    ['v1 tiers', V1_TIERS],
    ['v2 early', V2_EARLY],
    ['v2 production', V2_PRODUCTION],
  ])('%s: loading is a fixed point', (_, raw) => {
    const once = parsePreferences(raw)!
    expect(parsePreferences(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('has a migration step for every version below the current one', () => {
    for (let version = 1; version < PREFS_SCHEMA_VERSION; version++) {
      expect(MIGRATIONS[version], `migration from v${version}`).toBeTypeOf('function')
    }
  })

  it('reads a missing or malformed schemaVersion as version 1', () => {
    expect(storedSchemaVersion({})).toBe(1)
    expect(storedSchemaVersion({ schemaVersion: '2' })).toBe(1)
    expect(storedSchemaVersion({ schemaVersion: 0 })).toBe(1)
    expect(storedSchemaVersion({ schemaVersion: 2.5 })).toBe(1)
    expect(storedSchemaVersion({ schemaVersion: 2 })).toBe(2)
  })
})

describe('parsePreferences: leniency', () => {
  const LA = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }

  it('needs an object with a valid location or fallback', () => {
    expect(parsePreferences(null)).toBeNull()
    expect(parsePreferences([])).toBeNull()
    expect(parsePreferences({ location: { lat: 91, lon: 0, city: 'x' } })).toBeNull()
    expect(parsePreferences({}, { fallbackLocation: LA })?.location).toEqual(LA)
  })

  it('drops malformed list elements instead of failing the whole document', () => {
    // A non-string id used to throw inside the normalizer, which locked the person out.
    const prefs = parsePreferences({
      location: LA,
      activities: [{ id: 7, name: 'Odd id' }, null, 'run', { name: 42 }],
      profiles: [
        { id: 'p', name: '  ', skinType: 'fair' },
        { name: 'Kid', skinType: 'pale' },
      ],
    })!
    expect(prefs.activities).toEqual([
      {
        id: 'migrated_0',
        name: 'Odd id',
        icon: '☀️',
        durationMins: 30,
        maxUV: 4,
        sunscreen: false,
      },
    ])
    expect(prefs.profiles).toBeUndefined()
  })

  it('caps every list and name at the limits the rules enforce', () => {
    const prefs = parsePreferences({
      location: { ...LA, city: 'c'.repeat(200), region: 'r'.repeat(200) },
      savedLocations: Array.from({ length: 20 }, (_, i) => ({ lat: i, lon: i, city: `C${i}` })),
      profiles: Array.from({ length: 20 }, (_, i) => ({
        id: `p${i}`,
        name: 'n'.repeat(60),
        skinType: 'fair',
      })),
      activities: Array.from({ length: 30 }, (_, i) => ({ ...activity(i), name: 'a'.repeat(150) })),
      upgradeInterest: { email: `${'e'.repeat(300)}@x.co`, createdAt: '2026-05-01T12:00:00.000Z' },
    })!
    expect(prefs.location.city).toHaveLength(PREFS_LIMITS.placeNameLength)
    expect(prefs.location.region).toHaveLength(PREFS_LIMITS.placeNameLength)
    expect(prefs.savedLocations).toHaveLength(PREFS_LIMITS.savedLocations)
    expect(prefs.profiles).toHaveLength(PREFS_LIMITS.profiles)
    expect(prefs.profiles?.every(p => p.name.length === PREFS_LIMITS.profileNameLength)).toBe(true)
    expect(prefs.activities).toHaveLength(PREFS_LIMITS.activities)
    expect(prefs.activities.every(a => a.name.length === PREFS_LIMITS.activityNameLength)).toBe(
      true,
    )
    expect(prefs.upgradeInterest?.email).toHaveLength(PREFS_LIMITS.emailLength)
  })

  it('drops values the rules would reject', () => {
    const prefs = parsePreferences({
      location: { ...LA, timezone: `Area/${'x'.repeat(70)}` },
      upgradeInterest: { createdAt: `2026-05-01T12:00:00.000Z${' '.repeat(30)}` },
      activeProfileId: 'nobody',
    })!
    expect(prefs.location.timezone).toBeUndefined()
    expect(prefs.upgradeInterest).toBeUndefined()
    expect(prefs).not.toHaveProperty('activeProfileId')
  })
})

describe('newer schema versions', () => {
  const newer = { ...V2_PRODUCTION, schemaVersion: PREFS_SCHEMA_VERSION + 1, futureField: 1 }

  it('are read best-effort but keep their version', () => {
    const prefs = parsePreferences(newer)!
    expect(prefs.schemaVersion).toBe(PREFS_SCHEMA_VERSION + 1)
    expect(prefs.location.city).toBe('San Diego')
    expect(isWritablePreferences(prefs)).toBe(false)
  })

  it('are never turned into a write', () => {
    const prefs = parsePreferences(newer)!
    expect(() => clientPreferencesUpdate(prefs)).toThrow(NewerPreferencesVersionError)
  })
})

describe('clientPreferencesUpdate', () => {
  const prefs = parsePreferences(V2_PRODUCTION)!

  it('writes only client-owned fields', () => {
    const update = clientPreferencesUpdate(prefs)
    expect(update).not.toHaveProperty('uid')
    expect(update).not.toHaveProperty('tier')
    expect(update).not.toHaveProperty('calendarFeedToken')
    expect(Object.keys(update).every(k => (CLIENT_PREFERENCE_FIELDS as string[]).includes(k))).toBe(
      true,
    )
    expect(update.schemaVersion).toBe(PREFS_SCHEMA_VERSION)
  })

  it('clears profiles with an empty list, since clients cannot remove fields', () => {
    const withoutProfiles: UserPreferences = { ...prefs, profiles: undefined }
    delete withoutProfiles.activeProfileId
    const update = clientPreferencesUpdate(withoutProfiles)
    expect(update.profiles).toEqual([])
    expect(update).not.toHaveProperty('activeProfileId')
    expect(Object.values(update)).not.toContain(undefined)
  })
})
