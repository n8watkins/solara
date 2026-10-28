const { after, afterEach, before, describe, test } = require('node:test')
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

  test('account deletion must use the recursive server endpoint', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice').set(prefs('alice'))
    })
    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertFails(ref.delete())
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

describe('plan limits (lib/tiers.ts TIER_LIMITS)', () => {
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
