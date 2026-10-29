const { after, afterEach, before, beforeEach, describe, test } = require('node:test')
const fs = require('node:fs')
const firebase = require('firebase/compat/app')
require('firebase/compat/firestore')
const path = require('node:path')
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing')

const projectId = 'demo-solara'
let testEnv

function prefs(uid, overrides = {}) {
  return {
    uid,
    schemaVersion: 2,
    location: { lat: 47.61, lon: -122.33, city: 'Seattle', region: 'WA' },
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'free',
    onboardingComplete: true,
    ...overrides,
  }
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
    },
  })
})

afterEach(async () => testEnv.clearFirestore())

/** Stores `users/{uid}` as the server would (tier is server-owned) and returns the owner's ref. */
async function seededRef(uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`users/${uid}`).set(prefs(uid, overrides))
  })
  return testEnv.authenticatedContext(uid).firestore().doc(`users/${uid}`)
}
after(async () => testEnv.cleanup())

/**
 * Lists record keys in users/{uid}/meta/{name} as the app's batched writes do, so the
 * tests of a record's fields can write it on its own (see 'per-account record caps').
 */
async function seedKeyIndex(uid, name, keys) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const ids = Object.fromEntries(keys.map(key => [key, true]))
    await context.firestore().doc(`users/${uid}/meta/${name}`).set({ ids, removed: [] })
  })
}

describe('user preferences', () => {
  test('an owner can create and update allowlisted preference fields', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice')

    await assertSucceeds(ref.set(prefs('alice')))
    await assertSucceeds(
      ref.update({
        skinType: 'olive',
        showSunPath: false,
        notificationHour: 8,
      }),
    )
  })

  test('a user cannot access another account', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice').set(prefs('alice'))
    })

    const ref = testEnv.authenticatedContext('mallory').firestore().doc('users/alice')
    await assertFails(ref.get())
    await assertFails(ref.update({ skinType: 'dark' }))
    await assertFails(ref.delete())
  })

  test('an account with billing can only be deleted by the server endpoint', async () => {
    // A Stripe customer or a paid plan must be ended by the deleteAccount Function; the
    // rest is in 'self-service account deletion' below.
    for (const billing of [
      { tier: 'paid' },
      { stripeCustomerId: 'cus_123' },
      { tier: 'free', stripeCustomerId: 'cus_123', subscriptionStatus: 'canceled' },
    ]) {
      const ref = await seededRef('alice', billing)
      await assertFails(ref.delete())
    }
  })

  test('a deletion tombstone blocks every token until deletion completes', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('accountDeletionTombstones/alice').set({ revokedBefore: 200 })
    })

    const stale = testEnv.authenticatedContext('alice', { auth_time: 200 }).firestore()
    const fresh = testEnv.authenticatedContext('alice', { auth_time: 201 }).firestore()
    await assertFails(stale.doc('users/alice').set(prefs('alice')))
    await assertFails(fresh.doc('users/alice').set(prefs('alice')))
    await assertFails(stale.doc('accountDeletionTombstones/alice').get())
  })

  test('server-owned and unknown fields cannot be created by a client', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()

    await assertFails(db.doc('users/alice').set(prefs('alice', { tier: 'paid' })))
    await assertFails(db.doc('users/alice').set(prefs('alice', { stripeCustomerId: 'cus_123' })))
    await assertFails(db.doc('users/alice').set(prefs('alice', { notificationsEnabled: true })))
  })

  test('notification delivery hour is a morning hour the schema allows (5-10)', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice')
    await assertSucceeds(ref.set(prefs('alice', { notificationHour: 8 })))
    await assertSucceeds(ref.update({ notificationHour: 5 }))
    await assertSucceeds(ref.update({ notificationHour: 10 }))
    await assertFails(ref.update({ notificationHour: 4 }))
    await assertFails(ref.update({ notificationHour: 11 }))
    await assertFails(ref.update({ notificationHour: 24 }))
    await assertFails(ref.update({ notificationHour: 7.5 }))
    await assertFails(ref.update({ notificationHour: 'morning' }))
  })

  test('location requires bounded coordinates and typed display fields', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice')
    await assertSucceeds(ref.set(prefs('alice')))
    await assertSucceeds(
      ref.update({
        location: { lat: -90, lon: 180, city: 'Boundary', region: '', timezone: 'UTC' },
      }),
    )
    await assertFails(
      ref.update({
        location: { lat: 91, lon: 0, city: 'Invalid', region: '' },
      }),
    )
    await assertFails(
      ref.update({
        location: { lat: 0, lon: -181, city: 'Invalid', region: '' },
      }),
    )
    await assertFails(
      ref.update({
        location: { lat: 0, lon: 0, city: 123, region: '' },
      }),
    )
    // A list or map has a size() too, so only the type check rejects these.
    await assertFails(ref.update({ location: { lat: 0, lon: 0, city: ['Seattle'], region: '' } }))
    await assertFails(ref.update({ location: { lat: 0, lon: 0, city: 'Seattle', region: ['WA'] } }))
    await assertFails(
      ref.update({
        location: { lat: 0, lon: 0, city: 'Missing region' },
      }),
    )
  })

  test('saved locations are bounded and each location is valid', async () => {
    const ref = await seededRef('alice', { tier: 'paid' })
    const savedLocations = Array.from({ length: 12 }, (_, index) => ({
      lat: index,
      lon: -index,
      city: `City ${index}`,
      region: 'WA',
    }))

    await assertSucceeds(ref.update({ savedLocations }))
    await assertFails(
      ref.update({
        savedLocations: [...savedLocations, { lat: 20, lon: 20, city: 'Extra', region: 'WA' }],
      }),
    )
    await assertFails(
      ref.update({
        savedLocations: [{ lat: '47', lon: 0, city: 'Invalid', region: 'WA' }],
      }),
    )
    await assertFails(ref.update({ savedLocations: [{ lat: 0, lon: 0, city: 'Missing region' }] }))
    await assertFails(ref.update({ savedLocations: 'Seattle' }))
  })

  test('server-owned fields remain unchanged during preference updates', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice')
        .set(
          prefs('alice', {
            tier: 'paid',
            stripeCustomerId: 'cus_123',
            subscriptionStatus: 'active',
          }),
        )
    })

    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertSucceeds(ref.update({ skinType: 'medium' }))
    await assertFails(ref.update({ tier: 'free' }))
    await assertFails(ref.update({ stripeCustomerId: 'cus_attacker' }))
    await assertFails(ref.update({ subscriptionStatus: 'canceled' }))
  })

  test('only the server names where a subscription was bought', async () => {
    // subscriptionProvider decides which store's entitlement check applies
    // (functions/src/billing/entitlement.ts), so a client may never set or change it.
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice')
        .set(prefs('alice', { tier: 'paid', subscriptionProvider: 'stripe' }))
    })
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertSucceeds(ref.update({ skinType: 'medium' }))
    await assertFails(ref.update({ subscriptionProvider: 'google-play' }))
    await assertFails(ref.update({ subscriptionProvider: null }))
    const bob = testEnv.authenticatedContext('bob').firestore().doc('users/bob')
    await assertFails(bob.set({ ...prefs('bob'), subscriptionProvider: 'stripe' }))
    await assertSucceeds(bob.set(prefs('bob')))
  })
})

function activity(overrides = {}) {
  return {
    id: 'walk',
    name: 'Walking',
    icon: '🚶',
    durationMins: 30,
    maxUV: 5,
    sunscreen: false,
    ...overrides,
  }
}

function fullActivity(index) {
  return activity({
    id: `custom_${index}`,
    name: `Activity ${index}`,
    custom: true,
    preferredHours: { from: 6, to: 20 },
    timePreference: 'latest',
    daysOfWeek: [0, 1, 2, 3, 4, 5],
    cloudSensitive: true,
    shade: 'partial',
    surface: 'sand',
    avoidRain: false,
    maxFeelsLikeC: 35,
  })
}

describe('typed and size-capped preference fields', () => {
  async function ownerRef() {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertSucceeds(ref.set(prefs('alice')))
    return ref
  }

  test('a realistic fully populated document is accepted on create', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    const location = { lat: 1, lon: 2, city: 'Seattle', region: 'WA' }
    await assertSucceeds(
      ref.set(
        prefs('alice', {
          location: { ...location, timezone: 'America/Los_Angeles' },
          savedLocations: [location, { ...location, lat: 3 }],
          profiles: [{ id: 'profile_0', name: 'Me', skinType: 'fair', icon: '🧑' }],
          activeProfileId: 'profile_0',
          activities: Array.from({ length: 3 }, (_, i) => fullActivity(i)),
          calendarHours: { from: 6, to: 20 },
          showSunPath: true,
          hiddenActivitySuggestionIds: ['run', 'dog'],
          collapsedActivityCategories: ['Water sports'],
          upgradeInterest: { email: 'a@example.com', createdAt: '2026-10-23T00:00:00.000Z' },
          notificationHour: 7,
        }),
      ),
    )
  })

  // The rules engine evaluates at most 1,000 expressions per request. Each list is checked
  // at its cap on its own (the client saves one change at a time), and a realistic Pro
  // account changing several lists in one write must also fit.
  test('each list can be saved at its cap within the expression budget', async () => {
    // The caps are Pro's; a downgraded account keeps its lists, so the absolute caps
    // must fit too (profiles: 12 is above Pro's 6).
    const ref = await seededRef('alice', { tier: 'paid' })
    const location = { lat: 1, lon: 2, city: 'C'.repeat(120), region: 'R'.repeat(120) }
    await assertSucceeds(
      ref.update({ activities: Array.from({ length: 20 }, (_, i) => fullActivity(i)) }),
    )
    await assertSucceeds(ref.update({ savedLocations: Array.from({ length: 12 }, () => location) }))
    const profiles = i => ({
      id: `profile_${i}`,
      name: 'N'.repeat(40),
      skinType: 'dark',
      icon: '👶',
    })
    await assertSucceeds(ref.update({ profiles: Array.from({ length: 6 }, (_, i) => profiles(i)) }))
    const downgraded = await seededRef('bob', {
      tier: 'free',
      profiles: Array.from({ length: 12 }, (_, i) => profiles(i)),
    })
    // An edit (not a no-op) so the whole list is checked.
    await assertSucceeds(
      downgraded.update({
        profiles: Array.from({ length: 12 }, (_, i) => ({ ...profiles(i), name: 'M'.repeat(40) })),
      }),
    )
  })

  test('a realistic multi-list write fits the expression budget', async () => {
    const ref = await seededRef('alice', { tier: 'paid' })
    const location = { lat: 1, lon: 2, city: 'Seattle', region: 'WA', timezone: 'UTC' }
    await assertSucceeds(
      ref.update({
        activities: Array.from({ length: 8 }, (_, i) => fullActivity(i)),
        savedLocations: Array.from({ length: 4 }, () => location),
        profiles: Array.from({ length: 3 }, (_, i) => ({
          id: `profile_${i}`,
          name: 'Kid',
          skinType: 'fair',
        })),
        hiddenActivitySuggestionIds: ['run', 'jog'],
        collapsedActivityCategories: ['Water sports'],
        calendarHours: { from: 6, to: 20 },
        notificationHour: 7,
        skinType: 'dark',
        groupMode: true,
        groupProfileIds: ['profile_0', 'profile_2'],
      }),
    )
  })

  test('core fields are required on create', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    for (const field of ['schemaVersion', 'skinType', 'sunscreen', 'activities']) {
      const data = prefs('alice')
      delete data[field]
      await assertFails(ref.set(data))
    }
  })

  test('uid must match the account and cannot change', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertFails(ref.set(prefs('mallory')))
    await assertSucceeds(ref.set(prefs('alice')))
    await assertFails(ref.update({ uid: 'mallory' }))
  })

  test('tier can only start as anonymous or free', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertFails(ref.set(prefs('alice', { tier: 'paid' })))
    await assertFails(ref.set(prefs('alice', { tier: 'admin' })))
    await assertSucceeds(ref.set(prefs('alice', { tier: 'anonymous' })))
  })

  test('schemaVersion is a bounded integer', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ schemaVersion: 3 }))
    await assertFails(ref.update({ schemaVersion: 0 }))
    await assertFails(ref.update({ schemaVersion: 3.5 }))
    await assertFails(ref.update({ schemaVersion: '4' }))
  })

  test('schemaVersion never goes down', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ schemaVersion: 3 }))
    // An older client may still save its other preferences without touching the version.
    await assertSucceeds(ref.update({ showSunPath: false }))
    await assertSucceeds(ref.update({ schemaVersion: 3, showSunPath: true }))
    await assertFails(ref.update({ schemaVersion: 2 }))
    await assertFails(ref.update({ schemaVersion: 1, showSunPath: false }))
  })

  test('location display fields are capped and unknown keys rejected', async () => {
    const ref = await ownerRef()
    const base = { lat: 1, lon: 2, city: 'Seattle', region: 'WA' }
    await assertFails(ref.update({ location: { ...base, city: 'C'.repeat(121) } }))
    await assertFails(ref.update({ location: { ...base, region: 'R'.repeat(121) } }))
    await assertFails(ref.update({ location: { ...base, timezone: 'T'.repeat(65) } }))
    await assertFails(ref.update({ location: { ...base, timezone: 7 } }))
    await assertFails(ref.update({ location: { ...base, extra: true } }))
    await assertFails(ref.update({ location: { ...base, lat: '1' } }))
  })

  test('saved locations reject oversized, mistyped or extra fields', async () => {
    const ref = await ownerRef()
    const base = { lat: 1, lon: 2, city: 'Seattle', region: 'WA' }
    await assertSucceeds(ref.update({ savedLocations: [] }))
    await assertSucceeds(ref.update({ savedLocations: [base] }))
    await assertFails(ref.update({ savedLocations: [{ ...base, city: 'C'.repeat(121) }] }))
    await assertFails(ref.update({ savedLocations: [{ ...base, city: ['Seattle'] }] }))
    await assertFails(ref.update({ savedLocations: [{ ...base, region: { state: 'WA' } }] }))
    await assertFails(ref.update({ savedLocations: [{ ...base, payload: 'x' }] }))
    await assertFails(ref.update({ savedLocations: Array.from({ length: 13 }, () => base) }))
  })

  test('skinType is one of the known types', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ skinType: 'very-fair' }))
    await assertFails(ref.update({ skinType: 'blue' }))
    await assertFails(ref.update({ skinType: 3 }))
  })

  test('profiles are a capped list of typed profiles', async () => {
    const ref = await seededRef('alice', { tier: 'paid' })
    const profile = { id: 'kid', name: 'Kid', skinType: 'fair' }
    await assertSucceeds(ref.update({ profiles: [profile, { ...profile, id: 'me', icon: '🧑' }] }))
    await assertFails(ref.update({ profiles: Array.from({ length: 13 }, () => profile) }))
    await assertFails(ref.update({ profiles: [{ ...profile, name: 'N'.repeat(41) }] }))
    await assertFails(ref.update({ profiles: [{ ...profile, notes: 'x' }] }))
    await assertFails(ref.update({ profiles: 'kid' }))
  })

  test('activeProfileId is a short identifier', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ activeProfileId: 'profile_1' }))
    await assertFails(ref.update({ activeProfileId: 'x'.repeat(65) }))
    await assertFails(ref.update({ activeProfileId: 4 }))
  })

  test('sunscreen is a boolean', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ sunscreen: true }))
    await assertFails(ref.update({ sunscreen: 'yes' }))
  })

  test('activities are a capped list with allowlisted keys and bounded names', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ activities: [activity(), fullActivity(1)] }))
    await assertFails(
      ref.update({ activities: Array.from({ length: 21 }, (_, i) => fullActivity(i)) }),
    )
    await assertFails(ref.update({ activities: 'walk' }))
    await assertFails(ref.update({ activities: [activity({ name: 'N'.repeat(101) })] }))
    await assertFails(ref.update({ activities: [activity({ notes: 'x'.repeat(1000) })] }))
    await assertFails(ref.update({ activities: [{ id: 'walk' }] }))
  })

  test('free text in lists must be a string, not a list or map of the same size', async () => {
    const ref = await seededRef('alice', { tier: 'paid' })
    await assertSucceeds(ref.update({ activities: [activity({ name: 'N'.repeat(100) })] }))
    await assertFails(ref.update({ activities: [activity({ name: ['N'] })] }))
    await assertFails(ref.update({ activities: [activity({ name: { text: 'N' } })] }))
    const profile = { id: 'kid', name: 'Kid', skinType: 'fair' }
    await assertSucceeds(ref.update({ profiles: [{ ...profile, name: 'N'.repeat(40) }] }))
    await assertFails(ref.update({ profiles: [{ ...profile, name: ['Kid'] }] }))
    // Multi-line and non-Latin text is still text.
    await assertSucceeds(ref.update({ activities: [activity({ name: 'Läufe\n🏃' })] }))
  })

  test('onboardingComplete is a boolean', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ onboardingComplete: false }))
    await assertFails(ref.update({ onboardingComplete: 'true' }))
  })

  test('calendarHours is a bounded from/to pair', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ calendarHours: { from: 6, to: 20 } }))
    await assertFails(ref.update({ calendarHours: { from: -1, to: 20 } }))
    await assertFails(ref.update({ calendarHours: { from: 6, to: 25 } }))
    await assertFails(ref.update({ calendarHours: { from: 6 } }))
    await assertFails(ref.update({ calendarHours: { from: 6, to: 20, extra: 1 } }))
  })

  test('group planning is a boolean and a short list of profile ids', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ groupMode: true }))
    await assertSucceeds(ref.update({ groupMode: false }))
    await assertFails(ref.update({ groupMode: 'yes' }))
    await assertSucceeds(ref.update({ groupProfileIds: [] }))
    await assertSucceeds(
      ref.update({ groupProfileIds: Array.from({ length: 12 }, (_, i) => `profile_${i}`) }),
    )
    await assertFails(
      ref.update({ groupProfileIds: Array.from({ length: 13 }, (_, i) => `profile_${i}`) }),
    )
    await assertFails(ref.update({ groupProfileIds: 'profile_0' }))
    // Their ids take at most 12 x 64 characters in all (REVIEW8 SEC L4).
    await assertSucceeds(
      ref.update({ groupProfileIds: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(64, 'p')) }),
    )
    await assertFails(
      ref.update({ groupProfileIds: Array.from({ length: 12 }, () => 'x'.repeat(60_000)) }),
    )
    await assertFails(ref.update({ groupProfileIds: ['x'.repeat(769)] }))
    await assertFails(ref.update({ groupProfileIds: [{ id: 'x'.repeat(1000) }] }))
  })

  test('showSunPath is a boolean', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ showSunPath: false }))
    await assertFails(ref.update({ showSunPath: 0 }))
  })

  test('display units are one of the known choices', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ temperatureUnit: 'celsius', clockFormat: '24h' }))
    await assertSucceeds(ref.update({ temperatureUnit: 'auto', clockFormat: 'auto' }))
    await assertFails(ref.update({ temperatureUnit: 'kelvin' }))
    await assertFails(ref.update({ clockFormat: 24 }))
  })

  test('the UV alert threshold is a whole UV index from 1 to 11, or 0 for off', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ uvAlertThreshold: 6 }))
    await assertSucceeds(ref.update({ uvAlertThreshold: 1 }))
    await assertSucceeds(ref.update({ uvAlertThreshold: 11 }))
    await assertSucceeds(ref.update({ uvAlertThreshold: 0 }))
    await assertFails(ref.update({ uvAlertThreshold: -1 }))
    await assertFails(ref.update({ uvAlertThreshold: 12 }))
    await assertFails(ref.update({ uvAlertThreshold: 5.5 }))
    await assertFails(ref.update({ uvAlertThreshold: '6' }))
  })

  test('event heads-ups are on or off', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ eventHeadsUp: false }))
    await assertSucceeds(ref.update({ eventHeadsUp: true }))
    await assertFails(ref.update({ eventHeadsUp: 'off' }))
    await assertFails(ref.update({ eventHeadsUp: 0 }))
  })

  test('the daily UV push is on or off', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ dailyUv: false }))
    await assertSucceeds(ref.update({ dailyUv: true }))
    await assertFails(ref.update({ dailyUv: 'off' }))
    await assertFails(ref.update({ dailyUv: 1 }))
  })

  test('quiet hours are a from/to pair of whole hours', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ quietHours: { from: 21, to: 7 } }))
    await assertSucceeds(ref.update({ quietHours: { from: 0, to: 0 } }))
    await assertSucceeds(ref.update({ quietHours: { from: 23, to: 23 } }))
    await assertFails(ref.update({ quietHours: { from: 24, to: 7 } }))
    await assertFails(ref.update({ quietHours: { from: 21, to: -1 } }))
    await assertFails(ref.update({ quietHours: { from: 21.5, to: 7 } }))
    await assertFails(ref.update({ quietHours: { from: 21 } }))
    await assertFails(ref.update({ quietHours: { from: 21, to: 7, extra: 1 } }))
    await assertFails(ref.update({ quietHours: [21, 7] }))
  })

  test('hidden suggestions may only name preset activities', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ hiddenActivitySuggestionIds: ['run', 'coffee'] }))
    await assertFails(ref.update({ hiddenActivitySuggestionIds: ['custom_1'] }))
    await assertFails(ref.update({ hiddenActivitySuggestionIds: ['x'.repeat(5000)] }))
    await assertFails(ref.update({ hiddenActivitySuggestionIds: 'run' }))
  })

  test('collapsed categories may only name known categories', async () => {
    const ref = await ownerRef()
    await assertSucceeds(ref.update({ collapsedActivityCategories: ['Quick breaks'] }))
    await assertFails(ref.update({ collapsedActivityCategories: ['Unknown'] }))
    await assertFails(ref.update({ collapsedActivityCategories: 'Quick breaks' }))
  })

  test('upgradeInterest is a small typed record', async () => {
    const ref = await ownerRef()
    const createdAt = '2026-10-23T00:00:00.000Z'
    await assertSucceeds(ref.update({ upgradeInterest: { createdAt } }))
    await assertSucceeds(ref.update({ upgradeInterest: { email: 'a@example.com', createdAt } }))
    await assertFails(ref.update({ upgradeInterest: { email: 'a@example.com' } }))
    await assertFails(ref.update({ upgradeInterest: { email: 'e'.repeat(255), createdAt } }))
    await assertFails(ref.update({ upgradeInterest: { createdAt, phone: '555' } }))
    await assertFails(ref.update({ upgradeInterest: { createdAt: 'x'.repeat(41) } }))
  })

  test('the retired top-level timezone is not writable (the location carries it)', async () => {
    const ref = await ownerRef()
    await assertFails(ref.update({ timezone: 'Europe/Berlin' }))
    await assertSucceeds(
      ref.update({
        location: { lat: 1, lon: 2, city: 'c', region: 'r', timezone: 'Europe/Berlin' },
      }),
    )
  })
})

describe('plan limits (packages/core/src/tiers.ts TIER_LIMITS)', () => {
  const activities = n => Array.from({ length: n }, (_, i) => fullActivity(i))
  const places = n =>
    Array.from({ length: n }, (_, i) => ({ lat: i, lon: i, city: `City ${i}`, region: 'WA' }))
  const people = n =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, skinType: 'fair' }))

  test('a Free account is held to Free capacity', async () => {
    const ref = await seededRef('alice', { tier: 'free' })
    await assertSucceeds(ref.update({ activities: activities(3) }))
    await assertFails(ref.update({ activities: activities(4) }))
    await assertSucceeds(ref.update({ savedLocations: places(3) }))
    await assertFails(ref.update({ savedLocations: places(4) }))
    await assertSucceeds(ref.update({ profiles: people(1) }))
    await assertFails(ref.update({ profiles: people(2) }))
  })

  test('an account with no stored tier, or the legacy anonymous one, counts as Free', async () => {
    const legacy = await seededRef('alice', { tier: 'anonymous' })
    await assertSucceeds(legacy.update({ activities: activities(3) }))
    await assertFails(legacy.update({ activities: activities(4) }))
    const untiered = await seededRef('bob')
    await testEnv.withSecurityRulesDisabled(async context => {
      const firestore = context.firestore()
      await firestore.doc('users/bob').update({ tier: firebase.firestore.FieldValue.delete() })
    })
    await assertFails(untiered.update({ activities: activities(4) }))
  })

  test('a new account starts within Free capacity', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertFails(ref.set(prefs('alice', { activities: activities(4) })))
    await assertFails(ref.set(prefs('alice', { tier: 'anonymous', savedLocations: places(4) })))
    await assertSucceeds(
      ref.set(prefs('alice', { activities: activities(3), savedLocations: places(3) })),
    )
  })

  test('a Pro account gets Pro capacity', async () => {
    const ref = await seededRef('alice', { tier: 'paid' })
    await assertSucceeds(ref.update({ activities: activities(20) }))
    await assertSucceeds(ref.update({ savedLocations: places(12) }))
    await assertSucceeds(ref.update({ profiles: people(6) }))
    await assertFails(ref.update({ profiles: people(7) }))
  })

  test('an account back on Free can edit and shrink its Pro lists, but not grow them', async () => {
    const ref = await seededRef('alice', {
      tier: 'free',
      activities: activities(10),
      savedLocations: places(6),
      profiles: people(4),
    })
    const edited = activities(10).map((a, i) => (i === 0 ? { ...a, name: 'Renamed' } : a))
    await assertSucceeds(ref.update({ activities: edited }))
    await assertSucceeds(ref.update({ activities: activities(9) }))
    await assertFails(ref.update({ activities: activities(10) }))
    await assertSucceeds(ref.update({ savedLocations: places(5) }))
    await assertFails(ref.update({ savedLocations: places(7) }))
    await assertSucceeds(ref.update({ profiles: people(4) }))
    await assertFails(ref.update({ profiles: people(5) }))
    // Unrelated fields still save while the lists are above the Free caps.
    await assertSucceeds(ref.update({ skinType: 'olive' }))
  })
})

describe('calendar feed tokens', () => {
  const TOKEN = 'A'.repeat(43)

  test('clients cannot create or set the retired feed token field', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertFails(ref.set(prefs('alice', { calendarFeedToken: TOKEN })))
    await assertSucceeds(ref.set(prefs('alice')))
    await assertFails(ref.update({ calendarFeedToken: TOKEN }))
  })

  test('a copied token cannot be written into another account', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice').set(prefs('alice', { calendarFeedToken: TOKEN }))
      await db.doc('users/mallory').set(prefs('mallory'))
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/mallory').update({ calendarFeedToken: TOKEN }))
    await assertFails(mallory.doc('calendarFeeds/anything').set({ uid: 'mallory' }))
  })

  test('the legacy field can be removed but not changed', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice')
        .set(prefs('alice', { calendarFeedToken: TOKEN }))
    })
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertSucceeds(ref.update({ skinType: 'dark' }))
    await assertFails(ref.update({ calendarFeedToken: 'B'.repeat(43) }))
    await assertSucceeds(ref.update({ calendarFeedToken: firebase.firestore.FieldValue.delete() }))
    await assertFails(ref.update({ calendarFeedToken: TOKEN }))
  })

  test('the feed index is server-only', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('calendarFeeds/hash').set({ uid: 'alice' })
    })
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.doc('calendarFeeds/hash').get())
    await assertFails(db.doc('calendarFeeds/hash').set({ uid: 'alice' }))
    await assertFails(db.doc('calendarFeeds/hash').delete())
    await assertFails(db.collection('calendarFeeds').get())
  })

  test('only the owner can read their private feed token, and nobody can write it', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice/private/calendarFeed')
        .set({ token: TOKEN, tokenHash: 'hash' })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertSucceeds(alice.doc('users/alice/private/calendarFeed').get())
    await assertFails(alice.doc('users/alice/private/calendarFeed').set({ token: TOKEN }))
    await assertFails(alice.doc('users/alice/private/calendarFeed').delete())
    await assertFails(mallory.doc('users/alice/private/calendarFeed').get())
    await assertFails(mallory.doc('users/mallory/private/calendarFeed').set({ token: TOKEN }))
  })

  test('linked calendar links are server-only; their summary is owner-readable only', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db
        .doc('eventSubscriptions/link1')
        .set({ uid: 'alice', url: 'https://secret.example/t' })
      await db.doc('users/alice/private/eventSubscriptions').set({ items: {} })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('eventSubscriptions/link1').get())
    await assertFails(alice.collection('eventSubscriptions').where('uid', '==', 'alice').get())
    await assertFails(alice.doc('eventSubscriptions/link2').set({ uid: 'alice', url: 'https://x' }))
    await assertFails(alice.doc('eventSubscriptions/link1').delete())
    await assertSucceeds(alice.doc('users/alice/private/eventSubscriptions').get())
    await assertFails(alice.doc('users/alice/private/eventSubscriptions').set({ items: {} }))
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/alice/private/eventSubscriptions').get())
  })

  test('a tombstoned account cannot read its private feed token', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice/private/calendarFeed').set({ token: TOKEN })
      await db.doc('accountDeletionTombstones/alice').set({ cleanupStatus: 'pending' })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('users/alice/private/calendarFeed').get())
  })
})

describe('notification devices', () => {
  const registration = {
    token: 'fcm-token-that-is-long-enough',
    enabled: true,
    platform: 'web',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }

  test('an owner can read but cannot mutate a device registration directly', async () => {
    const ref = testEnv
      .authenticatedContext('alice')
      .firestore()
      .doc('users/alice/notificationDevices/device-1')

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/notificationDevices/device-1').set(registration)
    })

    await assertSucceeds(ref.get())
    await assertFails(ref.set(registration))
    await assertFails(ref.update({ enabled: false, updatedAt: new Date() }))
    await assertFails(ref.delete())
  })

  test('a device list must be bounded', async () => {
    const devices = testEnv
      .authenticatedContext('alice')
      .firestore()
      .collection('users/alice/notificationDevices')
    await assertFails(devices.get())
    await assertFails(devices.limit(11).get())
    await assertSucceeds(devices.limit(10).get())
  })

  test('clients cannot write delivery state', async () => {
    const ref = testEnv
      .authenticatedContext('alice')
      .firestore()
      .doc('users/alice/notificationDevices/device-1')

    await assertFails(ref.set({ ...registration, lastError: 'fake' }))

    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice/notificationDevices/device-1')
        .set({
          ...registration,
          lastDeliveredAt: new Date(),
          lastNotificationKey: '2026-01-01:daily',
        })
    })

    await assertFails(ref.update({ enabled: false }))
    await assertFails(ref.update({ lastNotificationKey: 'attacker-controlled' }))
    await assertFails(ref.update({ lastError: null }))
  })

  test('another user cannot access a device registration', async () => {
    const ref = testEnv
      .authenticatedContext('mallory')
      .firestore()
      .doc('users/alice/notificationDevices/device-1')

    await assertFails(ref.set(registration))
    await assertFails(ref.get())
  })
})

describe('alert bookkeeping', () => {
  test('no client can read or write alert state or the alerts cursor', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice').set(prefs('alice'))
      await context.firestore().doc('users/alice/alertState/daily').set({ morning: {} })
      await context.firestore().doc('alertDispatch/state').set({ cursor: null })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('users/alice/alertState/daily').get())
    await assertFails(alice.doc('users/alice/alertState/daily').set({ morning: {} }))
    await assertFails(alice.doc('users/alice/alertState/daily').delete())
    await assertFails(alice.doc('alertDispatch/state').get())
    await assertFails(alice.doc('alertDispatch/state').set({ cursor: 'alice' }))
  })

  test('no client can read or change the forecast upstream budget', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('forecastUpstream/day-2026-10-27').set({ count: 1 })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('forecastUpstream/day-2026-10-27').get())
    await assertFails(alice.doc('forecastUpstream/day-2026-10-27').set({ count: 0 }))
    await assertFails(alice.doc('forecastUpstream/hour-2026-10-27T14').set({ count: 0 }))
  })
})

describe('trial history', () => {
  test('no client can read, list or write the trial-use record', async () => {
    const id = 'a'.repeat(64)
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`trialHistory/${id}`).set({ kind: 'card', trial: 'b' })
    })
    for (const db of [
      testEnv.authenticatedContext('alice').firestore(),
      testEnv.unauthenticatedContext().firestore(),
    ]) {
      await assertFails(db.doc(`trialHistory/${id}`).get())
      await assertFails(db.collection('trialHistory').get())
      await assertFails(db.doc(`trialHistory/${id}`).delete())
      await assertFails(db.doc(`trialHistory/${'c'.repeat(64)}`).set({ kind: 'card' }))
    }
  })
})

describe('server switches', () => {
  test('no client can read or change the cost guard', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('systemFlags/costGuard').set({ engaged: false })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    const anonymous = testEnv.unauthenticatedContext().firestore()
    for (const db of [alice, anonymous]) {
      await assertFails(db.doc('systemFlags/costGuard').get())
      await assertFails(db.doc('systemFlags/costGuard').set({ engaged: false }))
      await assertFails(db.collection('systemFlags').limit(1).get())
    }
  })
})

describe('scheduled activities', () => {
  beforeEach(() => seedKeyIndex('alice', 'scheduled', ['evt1', 'evt2', 'bad.id']))

  function scheduled(eventId, overrides = {}) {
    return {
      eventId,
      calendarId: 'primary',
      activityId: 'run',
      title: '🏃 Running: lower-UV window',
      icon: '🏃',
      start: '2026-06-16T01:00:00.000Z',
      end: '2026-06-16T01:45:00.000Z',
      timeZone: 'America/Los_Angeles',
      htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
      createdAt: '2026-06-15T17:30:00.000Z',
      updatedAt: '2026-06-15T17:30:00.000Z',
      // Firestore's TTL policy deletes the record after this (30 days after it ends).
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    }
  }

  test('an owner can create, read, list, update and delete their records', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice/scheduled/evt1')
    await assertSucceeds(ref.set(scheduled('evt1')))
    await assertSucceeds(ref.get())
    await assertSucceeds(
      db.collection('users/alice/scheduled').orderBy('start', 'desc').limit(100).get(),
    )
    await assertSucceeds(
      ref.set(
        scheduled('evt1', {
          start: '2026-06-16T02:00:00.000Z',
          end: '2026-06-16T02:45:00.000Z',
        }),
      ),
    )
    await assertSucceeds(ref.delete())
  })

  test('another user cannot read, list or write them', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/scheduled/evt1').set(scheduled('evt1'))
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/alice/scheduled/evt1').get())
    await assertFails(mallory.collection('users/alice/scheduled').limit(10).get())
    await assertFails(mallory.doc('users/alice/scheduled/evt2').set(scheduled('evt2')))
    await assertFails(mallory.doc('users/alice/scheduled/evt1').delete())
    const anonymous = testEnv.unauthenticatedContext().firestore()
    await assertFails(anonymous.doc('users/alice/scheduled/evt1').get())
  })

  test('list queries must be capped', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.collection('users/alice/scheduled').get())
    await assertFails(db.collection('users/alice/scheduled').limit(101).get())
    await assertSucceeds(db.collection('users/alice/scheduled').limit(100).get())
  })

  test('records are typed and size-capped', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice/scheduled/evt1')
    await assertFails(ref.set(scheduled('evt2')))
    await assertFails(ref.set(scheduled('evt1', { extra: true })))
    const { icon: _icon, ...missing } = scheduled('evt1')
    await assertFails(ref.set(missing))
    await assertFails(ref.set(scheduled('evt1', { calendarId: 'work' })))
    await assertFails(ref.set(scheduled('evt1', { activityId: '' })))
    await assertFails(ref.set(scheduled('evt1', { activityId: 'a'.repeat(65) })))
    await assertFails(ref.set(scheduled('evt1', { title: 'x'.repeat(201) })))
    await assertFails(ref.set(scheduled('evt1', { icon: 'x'.repeat(17) })))
    await assertFails(ref.set(scheduled('evt1', { start: 5 })))
    await assertFails(ref.set(scheduled('evt1', { end: '2026-06-16T00:00:00.000Z' })))
    await assertFails(ref.set(scheduled('evt1', { timeZone: 'x'.repeat(65) })))
    await assertFails(ref.set(scheduled('evt1', { htmlLink: 'https://evil.example/event' })))
    await assertFails(ref.set(scheduled('evt1', { htmlLink: 'javascript:alert(1)' })))
    await assertFails(
      ref.set(scheduled('evt1', { htmlLink: `https://www.google.com/${'x'.repeat(2048)}` })),
    )
    await assertFails(ref.set(scheduled('evt1', { createdAt: 'x'.repeat(41) })))
    // Every record must expire, and within the cap.
    const { expireAt: _expireAt, ...forever } = scheduled('evt1')
    await assertFails(ref.set(forever))
    await assertFails(ref.set(scheduled('evt1', { expireAt: '2026-07-16T01:45:00.000Z' })))
    await assertFails(
      ref.set(scheduled('evt1', { expireAt: new Date(Date.now() + 401 * 24 * 60 * 60 * 1000) })),
    )
    await assertFails(db.doc('users/alice/scheduled/bad.id').set(scheduled('bad.id')))
    await assertSucceeds(
      ref.set(scheduled('evt1', { htmlLink: 'https://calendar.google.com/calendar/event?eid=1' })),
    )
  })

  test('a tombstoned account cannot read or write its records', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice/scheduled/evt1').set(scheduled('evt1'))
      await db.doc('accountDeletionTombstones/alice').set({ revokedBefore: 200 })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('users/alice/scheduled/evt1').get())
    await assertFails(alice.doc('users/alice/scheduled/evt2').set(scheduled('evt2')))
  })
})

describe('imported events', () => {
  const KEY = 'a'.repeat(32)
  const OTHER = 'fedcba9876543210fedcba9876543210'
  const upper = KEY.toUpperCase()
  beforeEach(() => seedKeyIndex('alice', 'events', [KEY, OTHER, upper, 'evt1']))

  function importedEvent(key, overrides = {}) {
    return {
      key,
      source: 'file',
      seriesId: OTHER,
      title: 'Saturday 10K',
      start: '2026-06-20T15:00:00.000Z',
      end: '2026-06-20T16:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      where: 'Griffith Park, Los Angeles',
      lat: 34.14,
      lon: -118.29,
      placeLabel: 'Los Angeles, California',
      placeGuessed: false,
      activityId: 'run',
      url: 'https://example.com/run',
      createdAt: '2026-06-15T17:30:00.000Z',
      updatedAt: '2026-06-15T17:30:00.000Z',
      // Firestore's TTL policy deletes the record after this (30 days after it ends).
      expireAt: new Date(Date.parse('2026-06-20T16:30:00.000Z') + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    }
  }

  test('an owner can create, read, list, update and delete their events', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc(`users/alice/events/${KEY}`)
    await assertSucceeds(ref.set(importedEvent(KEY)))
    await assertSucceeds(ref.get())
    await assertSucceeds(
      db.collection('users/alice/events').orderBy('start', 'desc').limit(200).get(),
    )
    await assertSucceeds(
      ref.set(importedEvent(KEY, { placeGuessed: true, activityId: '', url: '' })),
    )
    await assertSucceeds(ref.delete())
  })

  test('another user cannot read, list or write them', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`users/alice/events/${KEY}`).set(importedEvent(KEY))
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc(`users/alice/events/${KEY}`).get())
    await assertFails(mallory.collection('users/alice/events').limit(10).get())
    await assertFails(mallory.doc(`users/alice/events/${OTHER}`).set(importedEvent(OTHER)))
    await assertFails(mallory.doc(`users/alice/events/${KEY}`).delete())
    const anonymous = testEnv.unauthenticatedContext().firestore()
    await assertFails(anonymous.doc(`users/alice/events/${KEY}`).get())
  })

  test('list queries must be capped', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.collection('users/alice/events').get())
    await assertFails(db.collection('users/alice/events').limit(201).get())
    await assertSucceeds(db.collection('users/alice/events').limit(200).get())
  })

  test('events are typed and size-capped', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc(`users/alice/events/${KEY}`)
    await assertFails(ref.set(importedEvent(OTHER)))
    await assertFails(ref.set(importedEvent(KEY, { extra: true })))
    const { where: _where, ...missing } = importedEvent(KEY)
    await assertFails(ref.set(missing))
    await assertFails(ref.set(importedEvent(KEY, { source: 'strava' })))
    await assertFails(ref.set(importedEvent(KEY, { seriesId: 'not-a-hash' })))
    await assertFails(ref.set(importedEvent(KEY, { title: 'x'.repeat(201) })))
    await assertFails(ref.set(importedEvent(KEY, { start: 5 })))
    await assertFails(ref.set(importedEvent(KEY, { end: '2026-06-20T14:00:00.000Z' })))
    await assertFails(ref.set(importedEvent(KEY, { timeZone: 'x'.repeat(65) })))
    await assertFails(ref.set(importedEvent(KEY, { where: 'x'.repeat(201) })))
    await assertFails(ref.set(importedEvent(KEY, { lat: 91 })))
    await assertFails(ref.set(importedEvent(KEY, { lon: '-118' })))
    await assertFails(ref.set(importedEvent(KEY, { placeLabel: 'x'.repeat(121) })))
    await assertFails(ref.set(importedEvent(KEY, { placeGuessed: 'yes' })))
    await assertFails(ref.set(importedEvent(KEY, { activityId: 'a'.repeat(65) })))
    await assertFails(ref.set(importedEvent(KEY, { url: 'javascript:alert(1)' })))
    await assertFails(ref.set(importedEvent(KEY, { url: 'http://example.com' })))
    await assertFails(
      ref.set(importedEvent(KEY, { url: `https://example.com/${'x'.repeat(2048)}` })),
    )
    await assertFails(ref.set(importedEvent(KEY, { createdAt: 'x'.repeat(41) })))
    // Every event must expire, and within the cap.
    const { expireAt: _expireAt, ...forever } = importedEvent(KEY)
    await assertFails(ref.set(forever))
    await assertFails(ref.set(importedEvent(KEY, { expireAt: '2026-07-20T16:30:00.000Z' })))
    await assertFails(
      ref.set(importedEvent(KEY, { expireAt: new Date(Date.now() + 401 * 24 * 60 * 60 * 1000) })),
    )
    // Keys are SHA-256 prefixes: lowercase hex, 32 characters.
    await assertFails(db.doc('users/alice/events/evt1').set(importedEvent('evt1')))
    await assertFails(db.doc(`users/alice/events/${upper}`).set(importedEvent(upper)))
    await assertSucceeds(ref.set(importedEvent(KEY)))
  })

  test('the app never creates linked calendar events, and changes only their place and activity', async () => {
    const FEED = 'c'.repeat(32)
    const feedEvent = importedEvent(KEY, { source: 'feed', feedId: FEED })
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc(`users/alice/events/${KEY}`)
    await assertFails(ref.set(feedEvent))
    // A file event cannot name a linked calendar or become one.
    await assertFails(ref.set(importedEvent(KEY, { feedId: FEED })))
    await assertSucceeds(ref.set(importedEvent(KEY)))
    await assertFails(ref.set(feedEvent))
    await assertSucceeds(ref.delete())

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`users/alice/events/${KEY}`).set(feedEvent)
    })
    await assertSucceeds(ref.get())
    // Set the place and what it counts as, as the Events section does (a full rewrite).
    await assertSucceeds(
      ref.set({
        ...feedEvent,
        lat: 33.77,
        lon: -118.19,
        placeLabel: 'Long Beach, California',
        placeGuessed: true,
        activityId: '',
        updatedAt: '2026-06-16T10:00:00.000Z',
      }),
    )
    const current = {
      ...feedEvent,
      lat: 33.77,
      lon: -118.19,
      placeLabel: 'Long Beach, California',
      placeGuessed: true,
      activityId: '',
      updatedAt: '2026-06-16T10:00:00.000Z',
    }
    for (const change of [
      { title: 'Renamed' },
      { start: '2026-06-20T14:00:00.000Z' },
      { url: 'https://phish.example.com' },
      { source: 'file' },
      { feedId: 'd'.repeat(32) },
      { where: 'Somewhere else' },
    ]) {
      await assertFails(ref.set({ ...current, ...change }))
    }
    const { feedId: _feedId, ...withoutFeed } = current
    await assertFails(ref.set({ ...withoutFeed, source: 'file' }))
    // The person may still delete one (it comes back with the next refresh).
    await assertSucceeds(ref.delete())
  })

  const googleLink = {
    calendars: [{ id: 'primary', name: '' }],
    connectedAt: '2026-06-15T17:30:00.000Z',
    syncedAt: '',
  }

  test('the app creates and rewrites events from Google Calendar, which keep their source', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(db.doc('users/alice/meta/googleCalendar').set(googleLink))
    const ref = db.doc(`users/alice/events/${KEY}`)
    const google = importedEvent(KEY, { source: 'google', url: '' })
    await assertSucceeds(ref.set(google))
    await assertSucceeds(ref.set({ ...google, title: 'Moved', placeLabel: 'Long Beach' }))
    // A Google event cannot become a file or linked calendar event, nor name a calendar link.
    await assertFails(ref.set({ ...google, source: 'file' }))
    await assertFails(ref.set({ ...google, feedId: 'c'.repeat(32) }))
    await assertSucceeds(ref.delete())
    // A file event cannot become a Google one either.
    await assertSucceeds(ref.set(importedEvent(KEY)))
    await assertFails(ref.set({ ...importedEvent(KEY), source: 'google' }))
  })

  test('Google events are refused once the connection is gone, so a disconnect wins (REVIEW6 L4)', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const link = db.doc('users/alice/meta/googleCalendar')
    const ref = db.doc(`users/alice/events/${KEY}`)
    const google = importedEvent(KEY, { source: 'google', url: '' })
    // Never connected: refused.
    await assertFails(ref.set(google))
    await assertSucceeds(link.set(googleLink))
    await assertSucceeds(ref.set(google))
    // Disconnected on another device: a refresh still running cannot rewrite or add events,
    // nor bring the connection back with a partial update.
    await assertSucceeds(link.delete())
    await assertFails(ref.set({ ...google, title: 'Moved' }))
    await assertFails(
      db
        .doc(`users/alice/events/${OTHER}`)
        .set(importedEvent(OTHER, { source: 'google', url: '' })),
    )
    await assertFails(link.update({ syncedAt: '2026-06-15T18:00:00.000Z' }))
    // The disconnect still removes the events, and files never depend on the connection.
    await assertSucceeds(ref.delete())
    await assertSucceeds(ref.set(importedEvent(KEY)))
  })

  const outlookLink = {
    calendars: [{ id: 'default', name: '' }],
    connectedAt: '2026-06-15T17:30:00.000Z',
    syncedAt: '',
  }

  test('the app creates and rewrites events from Outlook, which keep their source', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(db.doc('users/alice/meta/outlookCalendar').set(outlookLink))
    const ref = db.doc(`users/alice/events/${KEY}`)
    const outlook = importedEvent(KEY, { source: 'outlook', url: '' })
    await assertSucceeds(ref.set(outlook))
    await assertSucceeds(ref.set({ ...outlook, title: 'Moved', placeLabel: 'Long Beach' }))
    // An Outlook event cannot become another source's, nor name a calendar link.
    for (const source of ['file', 'google', 'feed']) {
      await assertFails(ref.set({ ...outlook, source }))
    }
    await assertFails(ref.set({ ...outlook, feedId: 'c'.repeat(32) }))
    await assertSucceeds(ref.delete())
    await assertSucceeds(ref.set(importedEvent(KEY)))
    await assertFails(ref.set({ ...importedEvent(KEY), source: 'outlook' }))
  })

  test('Outlook events need the Outlook connection, not Google’s, so a disconnect wins (REVIEW6 L4)', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const link = db.doc('users/alice/meta/outlookCalendar')
    const ref = db.doc(`users/alice/events/${KEY}`)
    const outlook = importedEvent(KEY, { source: 'outlook', url: '' })
    // Never connected, or connected to Google only: refused.
    await assertFails(ref.set(outlook))
    await assertSucceeds(db.doc('users/alice/meta/googleCalendar').set(googleLink))
    await assertFails(ref.set(outlook))
    await assertSucceeds(link.set(outlookLink))
    await assertSucceeds(ref.set(outlook))
    // Disconnected on another device: a refresh still running cannot rewrite or add events,
    // nor bring the connection back with a partial update.
    await assertSucceeds(link.delete())
    await assertFails(ref.set({ ...outlook, title: 'Moved' }))
    await assertFails(
      db
        .doc(`users/alice/events/${OTHER}`)
        .set(importedEvent(OTHER, { source: 'outlook', url: '' })),
    )
    await assertFails(link.update({ syncedAt: '2026-06-15T18:00:00.000Z' }))
    // Google events still depend on Google's connection only.
    await assertSucceeds(
      db
        .doc(`users/alice/events/${OTHER}`)
        .set(importedEvent(OTHER, { source: 'google', url: '' })),
    )
    await assertSucceeds(ref.delete())
  })

  test('a tombstoned account cannot read or write its events', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc(`users/alice/events/${KEY}`).set(importedEvent(KEY))
      await db.doc('accountDeletionTombstones/alice').set({ revokedBefore: 200 })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc(`users/alice/events/${KEY}`).get())
    await assertFails(alice.doc(`users/alice/events/${OTHER}`).set(importedEvent(OTHER)))
  })
})

// Events already in Google Calendar (phase 2b): users/{uid}/meta/googleCalendar names the
// calendars the app reads, at most 10, and is deleted when the person disconnects.
describe('Google Calendar connection', () => {
  const link = (overrides = {}) => ({
    calendars: [
      { id: 'primary', name: '' },
      { id: 'club@group.calendar.google.com', name: 'Running club' },
    ],
    connectedAt: '2026-06-15T17:30:00.000Z',
    syncedAt: '',
    ...overrides,
  })

  test('the owner can save, read, update and delete it', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice/meta/googleCalendar')
    await assertSucceeds(ref.set(link()))
    await assertSucceeds(ref.get())
    await assertSucceeds(ref.set(link({ syncedAt: '2026-06-15T18:00:00.000Z' })))
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}@group`, name: `C${i}` }))
    await assertSucceeds(ref.set(link({ calendars: ten })))
    await assertSucceeds(ref.delete())
  })

  test('it is typed and capped', async () => {
    const ref = testEnv
      .authenticatedContext('alice')
      .firestore()
      .doc('users/alice/meta/googleCalendar')
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}@group`, name: '' }))
    for (const bad of [
      link({ calendars: [] }),
      link({ calendars: eleven }),
      link({ calendars: 'primary' }),
      link({ calendars: [{ id: '', name: '' }] }),
      link({ calendars: [{ id: 'x'.repeat(257), name: '' }] }),
      link({ calendars: [{ id: 'primary', name: 'x'.repeat(121) }] }),
      link({ calendars: [{ id: 'primary', name: '', token: 'ya29.secret' }] }),
      link({ calendars: [{ id: 'primary' }] }),
      link({ calendars: [{ id: 'primary', name: '' }, 'club'] }),
      link({ token: 'ya29.secret' }),
      link({ syncedAt: 5 }),
      link({ connectedAt: 'x'.repeat(41) }),
    ]) {
      await assertFails(ref.set(bad))
    }
    const { syncedAt: _syncedAt, ...missing } = link()
    await assertFails(ref.set(missing))
  })

  test('nobody else can read or write it, and a key list that names a key stays', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/meta/googleCalendar').set(link())
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/alice/meta/googleCalendar').get())
    await assertFails(mallory.doc('users/alice/meta/googleCalendar').set(link()))
    await assertFails(mallory.doc('users/alice/meta/googleCalendar').delete())
    await seedKeyIndex('alice', 'events', ['a'.repeat(32)])
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('users/alice/meta/events').delete())
    await assertFails(alice.doc('users/alice/meta/other').set(link()))
  })
})

// Events already in Outlook (ROADMAP item 23): users/{uid}/meta/outlookCalendar names the
// calendars the app reads, at most 10, and is deleted when the person disconnects.
describe('Outlook calendar connection', () => {
  // Graph calendar ids are long base64 strings.
  const graphId = `AAMkAGI2TGuLAAA=${'A'.repeat(140)}`
  const link = (overrides = {}) => ({
    calendars: [
      { id: 'default', name: '' },
      { id: graphId, name: 'Running club' },
    ],
    connectedAt: '2026-06-15T17:30:00.000Z',
    syncedAt: '',
    ...overrides,
  })

  test('the owner can save, read, update and delete it', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice/meta/outlookCalendar')
    await assertSucceeds(ref.set(link()))
    await assertSucceeds(ref.get())
    await assertSucceeds(ref.set(link({ syncedAt: '2026-06-15T18:00:00.000Z' })))
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `${graphId}${i}`, name: `C${i}` }))
    await assertSucceeds(ref.set(link({ calendars: ten })))
    await assertSucceeds(ref.set(link({ calendars: [{ id: 'x'.repeat(512), name: '' }] })))
    await assertSucceeds(ref.delete())
  })

  test('it is typed and capped', async () => {
    const ref = testEnv
      .authenticatedContext('alice')
      .firestore()
      .doc('users/alice/meta/outlookCalendar')
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, name: '' }))
    for (const bad of [
      link({ calendars: [] }),
      link({ calendars: eleven }),
      link({ calendars: 'default' }),
      link({ calendars: [{ id: '', name: '' }] }),
      link({ calendars: [{ id: 'x'.repeat(513), name: '' }] }),
      link({ calendars: [{ id: 'default', name: 'x'.repeat(121) }] }),
      link({ calendars: [{ id: 'default', name: '', token: 'test-outlook-token' }] }),
      link({ calendars: [{ id: 'default' }] }),
      link({ calendars: [{ id: 'default', name: '' }, 'club'] }),
      link({ accessToken: 'test-outlook-token' }),
      link({ account: 'person@outlook.com' }),
      link({ syncedAt: 5 }),
      link({ connectedAt: 'x'.repeat(41) }),
    ]) {
      await assertFails(ref.set(bad))
    }
    const { syncedAt: _syncedAt, ...missing } = link()
    await assertFails(ref.set(missing))
  })

  test('nobody else can read or write it', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/meta/outlookCalendar').set(link())
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/alice/meta/outlookCalendar').get())
    await assertFails(mallory.doc('users/alice/meta/outlookCalendar').set(link()))
    await assertFails(mallory.doc('users/alice/meta/outlookCalendar').delete())
  })
})

// REVIEW4 M4: users/{uid}/meta/{events,scheduled} lists every record's key, so the rules
// can cap how many records an account holds (1,000 imported events, 500 scheduled
// activities) and no key can leave the list while its record still exists.
describe('per-account record caps', () => {
  const FieldValue = firebase.firestore.FieldValue
  const hex = n => n.toString(16).padStart(32, '0')
  const END = '2026-11-20T16:30:00.000Z'
  function importedEvent(key, overrides = {}) {
    return {
      key,
      source: 'file',
      seriesId: key,
      title: 'Saturday 10K',
      start: '2026-11-20T15:00:00.000Z',
      end: END,
      timeZone: 'America/Los_Angeles',
      where: '',
      lat: 34.14,
      lon: -118.29,
      placeLabel: 'Los Angeles, California',
      placeGuessed: false,
      activityId: '',
      url: '',
      createdAt: '2026-10-28T17:30:00.000Z',
      updatedAt: '2026-10-28T17:30:00.000Z',
      expireAt: new Date(Date.parse(END) + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    }
  }
  function scheduled(eventId) {
    return {
      eventId,
      calendarId: 'primary',
      activityId: 'run',
      title: 'Running',
      icon: '🏃',
      start: '2026-11-16T01:00:00.000Z',
      end: '2026-11-16T01:45:00.000Z',
      timeZone: 'America/Los_Angeles',
      htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
      createdAt: '2026-10-28T17:30:00.000Z',
      updatedAt: '2026-10-28T17:30:00.000Z',
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  }
  const index = (db, name) => db.doc(`users/alice/meta/${name}`)

  /** Saves events the way the app does: the records and their keys in one batch. */
  async function saveEvents(db, keys) {
    for (let i = 0; i < keys.length; i += 400) {
      const batch = db.batch()
      const slice = keys.slice(i, i + 400)
      for (const key of slice) batch.set(db.doc(`users/alice/events/${key}`), importedEvent(key))
      batch.set(
        index(db, 'events'),
        { ids: Object.fromEntries(slice.map(key => [key, true])), removed: [] },
        { merge: true },
      )
      await batch.commit()
    }
  }

  /** Deletes records and takes their keys off the list in one batch. */
  function removeBatch(db, name, keys, { deleteDocs = true, declared = keys } = {}) {
    const batch = db.batch()
    if (deleteDocs) for (const key of keys) batch.delete(db.doc(`users/alice/${name}/${key}`))
    batch.set(
      index(db, name),
      { ids: Object.fromEntries(keys.map(key => [key, FieldValue.delete()])), removed: declared },
      { merge: true },
    )
    return batch.commit()
  }

  test('a record can only be written with its key on the list', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.doc(`users/alice/events/${hex(1)}`).set(importedEvent(hex(1))))
    await assertFails(db.doc('users/alice/scheduled/evt1').set(scheduled('evt1')))
    await assertSucceeds(saveEvents(db, [hex(1)]))
    // Once listed, an update needs nothing more.
    await assertSucceeds(
      db.doc(`users/alice/events/${hex(1)}`).set(importedEvent(hex(1), { title: 'Renamed' })),
    )
    const batch = db.batch()
    batch.set(db.doc('users/alice/scheduled/evt1'), scheduled('evt1'))
    batch.set(index(db, 'scheduled'), { ids: { evt1: true }, removed: [] }, { merge: true })
    await assertSucceeds(batch.commit())
    await assertSucceeds(index(db, 'events').get())
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.doc('users/alice/meta/events').get())
    await assertFails(
      mallory.doc('users/alice/meta/events').set({ ids: {}, removed: [] }, { merge: true }),
    )
  })

  test('a key list holds only record keys mapped to true (REVIEW8 SEC L4)', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const write = (name, ids) => index(db, name).set({ ids, removed: [] }, { merge: true })
    await assertSucceeds(write('events', { [hex(1)]: true }))
    // Scheduled keys average at most 1,024 characters, commas included.
    await assertFails(write('scheduled', { [`${'e'.repeat(700)},${'f'.repeat(700)}`]: true }))
    await assertSucceeds(write('scheduled', { evt_1: true, 'a-B_9': true }))
    // The probe's inflation: 1,000 keys of the wrong shape with 900-character values.
    const big = 'x'.repeat(900)
    await assertFails(
      write('events', Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, big]))),
    )
    await assertFails(write('events', { [hex(2)]: big }))
    await assertFails(write('events', { [hex(2)]: false }))
    await assertFails(write('events', { [hex(2)]: 1 }))
    await assertFails(write('events', { ['x'.repeat(900)]: true }))
    await assertFails(write('events', { ['A'.repeat(32)]: true }))
    await assertFails(write('events', { [`${hex(2)},${hex(3)}`]: true }))
    await assertFails(write('scheduled', { ['e'.repeat(1025)]: true }))
    await assertFails(write('scheduled', { 'evt 1': true }))
    // A key holding commas would read as several keys; its length gives it away.
    await assertFails(
      write('events', { [Array.from({ length: 40 }, (_, i) => hex(i + 10)).join(',')]: true }),
    )
    // A key list already holding a bad entry (written before these checks) refuses every
    // write until it is cleaned, so a list never grows past one.
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc('users/alice/meta/scheduled')
        .set({
          ids: { evt_1: true, bad: 'x'.repeat(900) },
          removed: [],
        })
    })
    await assertFails(write('scheduled', { evt_2: true }))
  })

  test('an account holds at most 1,000 imported events', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const keys = Array.from({ length: 1000 }, (_, i) => hex(i + 1))
    await assertSucceeds(saveEvents(db, keys))
    await assertFails(saveEvents(db, [hex(5000)]))
    // Rewriting a stored event is not a new one.
    await assertSucceeds(saveEvents(db, [hex(7)]))
    // Removing one makes room for one.
    await assertSucceeds(removeBatch(db, 'events', [hex(1)]))
    await assertSucceeds(saveEvents(db, [hex(5000)]))
    await assertFails(saveEvents(db, [hex(5001)]))
  })

  test('an account holds at most 500 scheduled activities', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const ids = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`evt${i}`, true]))
      await context.firestore().doc('users/alice/meta/scheduled').set({ ids, removed: [] })
    })
    const db = testEnv.authenticatedContext('alice').firestore()
    const batch = db.batch()
    batch.set(db.doc('users/alice/scheduled/new1'), scheduled('new1'))
    batch.set(index(db, 'scheduled'), { ids: { new1: true }, removed: [] }, { merge: true })
    await assertFails(batch.commit())
    // Keys whose records are gone (deleted by Firestore's TTL policy) can be taken off.
    await assertSucceeds(removeBatch(db, 'scheduled', ['evt1', 'evt2'], { deleteDocs: false }))
    const retry = db.batch()
    retry.set(db.doc('users/alice/scheduled/new1'), scheduled('new1'))
    retry.set(index(db, 'scheduled'), { ids: { new1: true }, removed: [] }, { merge: true })
    await assertSucceeds(retry.commit())
  })

  test('a key leaves the list only when its record is gone and the write names it', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const keys = Array.from({ length: 12 }, (_, i) => hex(i + 1))
    await saveEvents(db, keys)
    // The record still exists.
    await assertFails(removeBatch(db, 'events', [hex(1)], { deleteDocs: false }))
    // Taken off without being named, or named without being taken off.
    await assertFails(removeBatch(db, 'events', [hex(1)], { declared: [] }))
    await assertFails(removeBatch(db, 'events', [], { declared: [hex(1)] }))
    // At most 8 keys per write.
    await assertFails(removeBatch(db, 'events', keys.slice(0, 9)))
    await assertSucceeds(removeBatch(db, 'events', keys.slice(0, 8)))
    // Deleting a record alone is always allowed; its key can be taken off later.
    await assertSucceeds(db.doc(`users/alice/events/${hex(9)}`).delete())
    await assertSucceeds(removeBatch(db, 'events', [hex(9)], { deleteDocs: false }))
    // A list that still names a key is never deleted, and it holds nothing else.
    await assertFails(index(db, 'events').delete())
    await assertFails(index(db, 'events').set({ ids: {}, removed: [], extra: 1 }, { merge: true }))
    await assertFails(index(db, 'other').set({ ids: {}, removed: [] }))
  })

  test('records stored before the list existed can be deleted and listed', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc(`users/alice/events/${hex(1)}`).set(importedEvent(hex(1)))
      await db.doc(`users/alice/events/${hex(2)}`).set(importedEvent(hex(2)))
    })
    const db = testEnv.authenticatedContext('alice').firestore()
    // With no list yet, the write that takes a key off leaves the list without `ids`.
    await assertSucceeds(removeBatch(db, 'events', [hex(1)]))
    // Listing an existing record is always allowed.
    await assertSucceeds(
      index(db, 'events').set({ ids: { [hex(2)]: true }, removed: [] }, { merge: true }),
    )
    await assertSucceeds(
      db.doc(`users/alice/events/${hex(2)}`).set(importedEvent(hex(2), { title: 'Renamed' })),
    )
  })

  test('an event expires at most 31 days after it ends', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const late = new Date(Date.parse(END) + 32 * 24 * 60 * 60 * 1000)
    const batch = db.batch()
    batch.set(db.doc(`users/alice/events/${hex(1)}`), importedEvent(hex(1), { expireAt: late }))
    batch.set(index(db, 'events'), { ids: { [hex(1)]: true }, removed: [] }, { merge: true })
    await assertFails(batch.commit())
    const odd = db.batch()
    odd.set(
      db.doc(`users/alice/events/${hex(1)}`),
      importedEvent(hex(1), { end: 'Fri Nov 20 2026 16:30:00 GMT', start: 'Fri Nov 20 2026' }),
    )
    odd.set(index(db, 'events'), { ids: { [hex(1)]: true }, removed: [] }, { merge: true })
    await assertFails(odd.commit())
    await assertSucceeds(saveEvents(db, [hex(1)]))
  })
})

// Self-service export and deletion without Functions (lib/account-self-service.ts): on the
// free Spark plan the browser deletes every document of users/{uid} itself, then the Auth
// user. These are the rules each of its deletes relies on.
describe('self-service account deletion', () => {
  const FieldValue = firebase.firestore.FieldValue
  const KEY = 'a'.repeat(32)
  const KEY2 = 'b'.repeat(32)

  function importedEvent(key) {
    return {
      key,
      source: 'file',
      seriesId: key,
      title: 'Saturday 10K',
      start: '2026-11-20T15:00:00.000Z',
      end: '2026-11-20T16:30:00.000Z',
      timeZone: 'America/Los_Angeles',
      where: '',
      lat: 34.14,
      lon: -118.29,
      placeLabel: 'Los Angeles, California',
      placeGuessed: false,
      activityId: '',
      url: '',
      createdAt: '2026-10-28T17:30:00.000Z',
      updatedAt: '2026-10-28T17:30:00.000Z',
      expireAt: new Date(Date.parse('2026-11-20T16:30:00.000Z') + 30 * 24 * 60 * 60 * 1000),
    }
  }
  function scheduled(eventId) {
    return {
      eventId,
      calendarId: 'primary',
      activityId: 'run',
      title: 'Running',
      icon: '🏃',
      start: '2026-11-16T01:00:00.000Z',
      end: '2026-11-16T01:45:00.000Z',
      timeZone: 'America/Los_Angeles',
      htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
      createdAt: '2026-10-28T17:30:00.000Z',
      updatedAt: '2026-10-28T17:30:00.000Z',
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  }
  const calendarLink = {
    calendars: [{ id: 'primary', name: '' }],
    connectedAt: '2026-10-28T17:30:00.000Z',
    syncedAt: '',
  }

  /** An account as the app leaves it: settings, events, scheduled activities, calendars. */
  async function seedAccount(uid) {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc(`users/${uid}`).set(prefs(uid))
      for (const key of [KEY, KEY2])
        await db.doc(`users/${uid}/events/${key}`).set(importedEvent(key))
      await db
        .doc(`users/${uid}/meta/events`)
        .set({ ids: { [KEY]: true, [KEY2]: true }, removed: [] })
      await db.doc(`users/${uid}/scheduled/evt1`).set(scheduled('evt1'))
      await db.doc(`users/${uid}/meta/scheduled`).set({ ids: { evt1: true }, removed: [] })
      await db.doc(`users/${uid}/meta/googleCalendar`).set(calendarLink)
      await db.doc(`users/${uid}/meta/outlookCalendar`).set(calendarLink)
    })
  }

  /** Deletes records and takes their keys off the list in one batch, as lib/key-index.ts does. */
  function removeRecords(db, uid, name, keys) {
    const batch = db.batch()
    for (const key of keys) batch.delete(db.doc(`users/${uid}/${name}/${key}`))
    batch.set(
      db.doc(`users/${uid}/meta/${name}`),
      { ids: Object.fromEntries(keys.map(key => [key, FieldValue.delete()])), removed: keys },
      { merge: true },
    )
    return batch.commit()
  }

  test('the owner can delete every document the app writes, in the app’s order', async () => {
    await seedAccount('alice')
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(removeRecords(db, 'alice', 'events', [KEY, KEY2]))
    await assertSucceeds(removeRecords(db, 'alice', 'scheduled', ['evt1']))
    await assertSucceeds(db.doc('users/alice/meta/events').delete())
    await assertSucceeds(db.doc('users/alice/meta/scheduled').delete())
    await assertSucceeds(db.doc('users/alice/meta/googleCalendar').delete())
    await assertSucceeds(db.doc('users/alice/meta/outlookCalendar').delete())
    await assertSucceeds(db.doc('users/alice').delete())

    await testEnv.withSecurityRulesDisabled(async context => {
      const admin = context.firestore()
      for (const path of ['users/alice/events', 'users/alice/scheduled', 'users/alice/meta']) {
        const left = await admin.collection(path).get()
        if (!left.empty) throw new Error(`${path} still holds ${left.size} documents`)
      }
      if ((await admin.doc('users/alice').get()).exists) throw new Error('users/alice is left')
    })
  })

  test('a deletion that stopped half way can run again', async () => {
    await seedAccount('alice')
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(removeRecords(db, 'alice', 'events', [KEY]))
    // Again from the start: records and keys already gone, documents already deleted.
    await assertSucceeds(removeRecords(db, 'alice', 'events', [KEY, KEY2]))
    await assertSucceeds(db.doc('users/alice/meta/events').delete())
    await assertSucceeds(db.doc('users/alice/meta/events').delete())
    await assertSucceeds(db.doc('users/alice').delete())
    await assertSucceeds(db.doc('users/alice').delete())
  })

  test('a key list is deleted only once it names no key, so the caps still hold', async () => {
    await seedAccount('alice')
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.doc('users/alice/meta/events').delete())
    await assertFails(db.doc('users/alice/meta/scheduled').delete())
    // Deleting the records alone does not empty the list.
    await assertSucceeds(db.doc(`users/alice/events/${KEY}`).delete())
    await assertFails(db.doc('users/alice/meta/events').delete())
    await assertSucceeds(removeRecords(db, 'alice', 'events', [KEY, KEY2]))
    await assertSucceeds(db.doc('users/alice/meta/events').delete())
    // Taking the last key off empties the list.
    await assertSucceeds(removeRecords(db, 'alice', 'scheduled', ['evt1']))
    await assertSucceeds(db.doc('users/alice/meta/scheduled').delete())
  })

  test('nobody else can delete an account’s documents', async () => {
    await seedAccount('alice')
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/meta/scheduled').set({ ids: {}, removed: [] })
    })
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    for (const path of [
      'users/alice',
      'users/alice/meta/scheduled',
      'users/alice/meta/googleCalendar',
      `users/alice/events/${KEY}`,
      'users/alice/scheduled/evt1',
    ]) {
      await assertFails(mallory.doc(path).delete())
    }
    await assertFails(testEnv.unauthenticatedContext().firestore().doc('users/alice').delete())
  })

  test('a tombstoned account cannot delete anything itself', async () => {
    await seedAccount('alice')
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/meta/scheduled').set({ ids: {}, removed: [] })
      await context.firestore().doc('accountDeletionTombstones/alice').set({ revokedBefore: 200 })
    })
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.doc('users/alice').delete())
    await assertFails(db.doc('users/alice/meta/scheduled').delete())
    await assertFails(db.doc(`users/alice/events/${KEY}`).delete())
  })

  test('server-only records stay server-only', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice').set(prefs('alice'))
      await db.doc('users/alice/notificationDevices/d1').set({ enabled: true })
      await db.doc('users/alice/private/calendarFeed').set({ token: 'secret' })
      await db.doc('users/alice/private/eventSubscriptions').set({ items: {} })
      await db.doc('users/alice/alertState/daily').set({})
    })
    const db = testEnv.authenticatedContext('alice').firestore()
    // The browser can see the first three, so it stops before deleting anything.
    await assertSucceeds(db.collection('users/alice/notificationDevices').limit(10).get())
    await assertSucceeds(db.doc('users/alice/private/calendarFeed').get())
    await assertSucceeds(db.doc('users/alice/private/eventSubscriptions').get())
    for (const path of [
      'users/alice/notificationDevices/d1',
      'users/alice/private/calendarFeed',
      'users/alice/private/eventSubscriptions',
      'users/alice/alertState/daily',
    ]) {
      await assertFails(db.doc(path).delete())
    }
  })
})

// Every collection only the server writes, and every collection group, refuse every client
// (REVIEW8 SEC L5): today the catch-all `match /{document=**}` does it, and these tests fail
// if a later rule, such as one for `{path=**}/events/{id}`, opens any of them.
describe('server-only collections and collection groups', () => {
  // Top-level collections the Functions own (functions/src), each with a sample document.
  const TOP_LEVEL = [
    'calendarFeeds/0123abcd',
    'eventSubscriptions/0123abcd',
    'systemFlags/costGuard',
    'systemMigrations/feedTokens',
    'trialHistory/0123abcd',
    'forecastUpstream/day-2026-10-28',
    'forecastCache/grid-34.06--118.24',
    'stripeWebhookEvents/evt_1',
    'stripeSubscriptionOwners/sub_1',
    'stripeCheckoutCleanupTasks/cs_1',
    'notificationTokenOwners/0123abcd',
    'notificationRegistrationLimits/alice',
    'alertDispatch/state',
    'accountDeletionTombstones/alice',
    'accountDeletionTombstones/alice/billingCleanupResources/customer_1',
  ]
  // Server-only records under the owner's own account.
  const UNDER_ACCOUNT = [
    'users/alice/billingResources/customer_1',
    'users/alice/alertState/daily',
    'users/alice/alertState/reapply',
    'users/alice/alertSchedule/dailyUv',
    'users/alice/somethingNew/doc',
  ]

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice').set(prefs('alice'))
      for (const path of [...TOP_LEVEL, ...UNDER_ACCOUNT]) {
        await db.doc(path).set({ uid: 'alice', owner: 'alice' })
      }
    })
  })

  test('no client can read, list or write any of them, even the account they name', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    const anonymous = testEnv.unauthenticatedContext().firestore()
    for (const db of [alice, anonymous]) {
      for (const path of [...TOP_LEVEL, ...UNDER_ACCOUNT]) {
        const ref = db.doc(path)
        await assertFails(ref.get(), path)
        await assertFails(ref.parent.limit(1).get(), path)
        await assertFails(ref.parent.where('uid', '==', 'alice').limit(1).get(), path)
        await assertFails(ref.set({ uid: 'alice' }), path)
        await assertFails(ref.update({ owner: 'mallory' }), path)
        await assertFails(ref.delete(), path)
        await assertFails(ref.parent.doc('new').set({ uid: 'alice' }), path)
      }
    }
  })

  test('no collection group query reaches anyone’s documents, even filtered to the caller', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await db.doc('users/alice/meta/events').set({ ids: {}, removed: [] })
      await db.doc('users/alice/private/calendarFeed').set({ uid: 'alice' })
      await db.doc('users/alice/notificationDevices/d1').set({ uid: 'alice' })
      await db.doc('users/alice/scheduled/evt1').set({ uid: 'alice' })
      await db.doc('users/alice/events/0123').set({ uid: 'alice' })
    })
    const groups = [
      'users',
      'events',
      'scheduled',
      'meta',
      'private',
      'notificationDevices',
      'alertState',
      'alertSchedule',
      'reminders',
      'billingResources',
      'billingCleanupResources',
      ...TOP_LEVEL.map(path => path.split('/').at(-2)),
    ]
    const alice = testEnv.authenticatedContext('alice').firestore()
    const anonymous = testEnv.unauthenticatedContext().firestore()
    for (const db of [alice, anonymous]) {
      for (const group of new Set(groups)) {
        await assertFails(db.collectionGroup(group).limit(1).get(), group)
        await assertFails(
          db.collectionGroup(group).where('uid', '==', 'alice').limit(1).get(),
          group,
        )
      }
    }
  })
})

// The sunscreen reapply reminder's "remind me at" record (functions/src/notifications/
// reminders.ts): one per account, written by its owner in exactly the shape the server
// sends from, and read or deleted only by its owner.
describe('reapply reminder record', () => {
  const MINUTE = 60_000
  const ID = '0123456789abcdef0123456789abcdef'
  const { Timestamp } = firebase.firestore

  function reminder({ mode = 'standard', appliedAt = Date.now(), minutes, ...rest } = {}) {
    const interval = minutes ?? (mode === 'water' ? 80 : 120)
    const remindAt = appliedAt + interval * MINUTE
    return {
      id: ID,
      mode,
      appliedAt: Timestamp.fromMillis(appliedAt),
      remindAt: Timestamp.fromMillis(remindAt),
      dueAt: Timestamp.fromMillis(remindAt),
      expireAt: Timestamp.fromMillis(remindAt + 24 * 60 * MINUTE),
      ...rest,
    }
  }

  async function aliceReminder() {
    await seededRef('alice')
    return testEnv.authenticatedContext('alice').firestore().doc('users/alice/reminders/reapply')
  }

  test('the owner schedules, replaces, reads and cancels it', async () => {
    const ref = await aliceReminder()
    await assertSucceeds(ref.set(reminder()))
    await assertSucceeds(ref.set(reminder({ mode: 'water', id: 'f'.repeat(32) })))
    await assertSucceeds(ref.get())
    await assertSucceeds(ref.delete())
  })

  test('one per account: no other document, and no listing', async () => {
    await aliceReminder()
    const db = testEnv.authenticatedContext('alice').firestore()
    await assertFails(db.doc('users/alice/reminders/second').set(reminder()))
    await assertFails(db.collection('users/alice/reminders').limit(1).get())
  })

  test('nobody else can read, write or cancel it', async () => {
    const ref = await aliceReminder()
    await assertSucceeds(ref.set(reminder()))
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    const signedOut = testEnv.unauthenticatedContext().firestore()
    for (const db of [mallory, signedOut]) {
      const theirs = db.doc('users/alice/reminders/reapply')
      await assertFails(theirs.get())
      await assertFails(theirs.set(reminder()))
      await assertFails(theirs.delete())
    }
  })

  test('the reminder is exactly the mode’s interval after the application, still ahead', async () => {
    const ref = await aliceReminder()
    await assertFails(ref.set(reminder({ minutes: 5 })))
    await assertFails(ref.set(reminder({ mode: 'water', minutes: 120 })))
    await assertFails(ref.set(reminder({ mode: 'sauna' })))
    // Applied 3 hours ago: its reminder is already past.
    await assertFails(ref.set(reminder({ appliedAt: Date.now() - 180 * MINUTE })))
    // Applied in the future, beyond a clock that runs a little fast.
    await assertFails(ref.set(reminder({ appliedAt: Date.now() + 60 * MINUTE })))
    await assertSucceeds(ref.set(reminder({ appliedAt: Date.now() + 2 * MINUTE })))
  })

  test('only the fields the server reads, typed', async () => {
    const ref = await aliceReminder()
    const base = reminder()
    await assertFails(ref.set({ ...base, status: 'claimed' }))
    await assertFails(ref.set({ ...base, id: 'not-hex' }))
    await assertFails(ref.set({ ...base, appliedAt: Date.now() }))
    await assertFails(ref.set({ ...base, dueAt: Timestamp.fromMillis(Date.now() + MINUTE) }))
    await assertFails(ref.set({ ...base, expireAt: base.remindAt }))
    const { dueAt: _dueAt, ...missing } = base
    await assertFails(ref.set(missing))
  })

  test('an account being deleted cannot schedule one', async () => {
    const ref = await aliceReminder()
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('accountDeletionTombstones/alice').set({ revokedBefore: 200 })
    })
    await assertFails(ref.set(reminder()))
  })
})
