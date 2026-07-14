const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  })
})

afterEach(async () => testEnv.clearFirestore())
after(async () => testEnv.cleanup())

describe('user preferences', () => {
  test('an owner can create and update allowlisted preference fields', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice')

    await assertSucceeds(ref.set(prefs('alice')))
    await assertSucceeds(ref.update({
      skinType: 'olive',
      showSunPath: false,
      notificationHour: 8,
    }))
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

  test('server-owned and unknown fields cannot be created by a client', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()

    await assertFails(db.doc('users/alice').set(prefs('alice', { tier: 'paid' })))
    await assertFails(db.doc('users/alice').set(prefs('alice', { stripeCustomerId: 'cus_123' })))
    await assertFails(db.doc('users/alice').set(prefs('alice', { notificationsEnabled: true })))
  })

  test('notification delivery hour must be a local hour', async () => {
    const db = testEnv.authenticatedContext('alice').firestore()
    const ref = db.doc('users/alice')
    await assertSucceeds(ref.set(prefs('alice', { notificationHour: 8 })))
    await assertFails(ref.update({ notificationHour: 24 }))
    await assertFails(ref.update({ notificationHour: 'morning' }))
  })

  test('server-owned fields remain unchanged during preference updates', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice').set(prefs('alice', {
        tier: 'paid',
        stripeCustomerId: 'cus_123',
        subscriptionStatus: 'active',
      }))
    })

    const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice')
    await assertSucceeds(ref.update({ skinType: 'medium' }))
    await assertFails(ref.update({ tier: 'free' }))
    await assertFails(ref.update({ stripeCustomerId: 'cus_attacker' }))
    await assertFails(ref.update({ subscriptionStatus: 'canceled' }))
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

  test('an owner can manage client registration fields', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore()
      .doc('users/alice/notificationDevices/device-1')

    await assertSucceeds(ref.set(registration))
    await assertSucceeds(ref.update({ enabled: false, updatedAt: new Date() }))
    await assertSucceeds(ref.get())
    await assertSucceeds(ref.delete())
  })

  test('clients cannot write delivery state', async () => {
    const ref = testEnv.authenticatedContext('alice').firestore()
      .doc('users/alice/notificationDevices/device-1')

    await assertFails(ref.set({ ...registration, lastError: 'fake' }))

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('users/alice/notificationDevices/device-1').set({
        ...registration,
        lastDeliveredAt: new Date(),
        lastNotificationKey: '2026-01-01:daily',
      })
    })

    await assertSucceeds(ref.update({ enabled: false }))
    await assertFails(ref.update({ lastNotificationKey: 'attacker-controlled' }))
    await assertFails(ref.update({ lastError: null }))
  })

  test('another user cannot access a device registration', async () => {
    const ref = testEnv.authenticatedContext('mallory').firestore()
      .doc('users/alice/notificationDevices/device-1')

    await assertFails(ref.set(registration))
    await assertFails(ref.get())
  })
})
