// The subscription and account lifecycle against the real Firestore emulator (run by
// `npm run test:rules`), with an in-memory Stripe (test/support/fake-stripe.js):
// checkout through the webhook, the past_due grace period, the account export's billing
// summary, and account deletion that cancels, deletes the Stripe customer, never stalls,
// and leaves only records that expire.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const {
  MAX_RESOURCE_ATTEMPTS,
  deleteAccount,
  processAccountDeletionPage,
} = require('../../lib/account/deletion')
const { exportAccountData } = require('../../lib/account/export')
const { createCheckout } = require('../../lib/billing/checkout')
const { TrialHistory } = require('../../lib/billing/trial-history')
const { endExpiredGracePeriods } = require('../../lib/billing/grace')
const { processStripeEvent } = require('../../lib/billing/webhook')
const { clearUidLimiters } = require('../../lib/shared/auth')
const { FakeStripe } = require('../support/fake-stripe')
const { captureLogs } = require('../support/logs')

const projectId = 'demo-solara-lifecycle'
const PRICES = { monthly: 'price_monthly', yearly: 'price_yearly' }
const DAY_MS = 24 * 60 * 60 * 1000
let app
let db
const logs = captureLogs()

/**
 * The Google account each test account signs in with: its own unless a test says that
 * two Solara accounts (say, one deleted and one created later) are the same person.
 */
const googleAccounts = new Map()
const googleAccount = uid =>
  googleAccounts.get(uid) ?? { sub: `google-${uid}`, email: `${uid}@example.com` }

function auth(uid, deletedUsers = []) {
  return {
    verifyIdToken: async () => {
      const google = googleAccount(uid)
      return {
        uid,
        email: google.email,
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000),
        firebase: {
          sign_in_provider: 'google.com',
          identities: { 'google.com': [google.sub], email: [google.email] },
        },
      }
    },
    getUser: async id => {
      const google = googleAccount(id)
      return {
        uid: id,
        email: google.email,
        emailVerified: true,
        providerData: [{ providerId: 'google.com', uid: google.sub, email: google.email }],
      }
    },
    revokeRefreshTokens: async () => {},
    deleteUser: async id => deletedUsers.push(id),
  }
}

const TRIAL_HISTORY_KEY = 'trial-history-test-key'
const trialHistory = () => new TrialHistory(db, TRIAL_HISTORY_KEY)

const request = body => ({ headers: { authorization: 'Bearer token' }, body })

async function seedAccount(uid) {
  await db.doc(`users/${uid}`).set({
    uid,
    schemaVersion: 2,
    location: { lat: 47.61, lon: -122.33, city: 'Seattle', region: 'WA' },
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'free',
    onboardingComplete: true,
  })
}

/** Buys Pro through checkout and the webhook, as a person would. */
async function subscribe(stripe, uid, { plan = 'monthly', trialDays = 0, created, card } = {}) {
  const session = await startCheckout(stripe, uid, plan)
  const event = stripe.complete(session.id, { trialDays, created, card })
  await deliver(stripe, event)
  const account = (await db.doc(`users/${uid}`).get()).data()
  return { subscriptionId: account.stripeSubscriptionId, customerId: account.stripeCustomerId }
}

/** Opens checkout for the account; the session's parameters say whether it has a trial. */
function startCheckout(stripe, uid, plan = 'monthly') {
  return createCheckout({
    appUrl: 'https://solara.example',
    auth: auth(uid),
    db,
    prices: PRICES,
    req: request({ attemptId: `attempt-${uid}-0000000000`, plan }),
    stripe,
    trialHistory: trialHistory(),
  })
}

const offeredTrialDays = (stripe, session) =>
  stripe.sessions.get(session.id)._params.subscription_data.trial_period_days

function deliver(stripe, event) {
  return processStripeEvent({
    auth: auth('stripe'),
    db,
    event,
    trialHistory: trialHistory(),
    prices: PRICES,
    serverTimestamp: () => new Date(),
    stripe,
  })
}

/** Runs deletion pages until the tombstone completes, moving retry times into the past. */
async function runDeletion(stripe, uid, { maxPages = 40 } = {}) {
  const tombstoneRef = db.doc(`accountDeletionTombstones/${uid}`)
  for (let page = 0; page < maxPages; page += 1) {
    const pending = await tombstoneRef
      .collection('billingCleanupResources')
      .where('status', '==', 'pending')
      .get()
    await Promise.all(pending.docs.map(doc => doc.ref.update({ nextAttemptAt: new Date(0) })))
    const result = await processAccountDeletionPage({
      auth: auth(uid),
      db,
      stripe,
      tombstoneRef,
      uid,
    })
    if (result.completed) return (await tombstoneRef.get()).data()
  }
  throw new Error('deletion did not complete')
}

async function clearFirestore() {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  assert.equal(response.ok, true)
}

function assertExpiresInDays(value, days) {
  const millis = value?.toMillis?.()
  assert.ok(Number.isFinite(millis), 'expireAt is a timestamp')
  assert.ok(Math.abs(millis - (Date.now() + days * DAY_MS)) < 60_000, `expires in ${days} days`)
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
  app = initializeApp({ projectId }, 'lifecycle-emulator-test')
  db = getFirestore(app)
})

afterEach(async () => {
  clearUidLimiters()
  googleAccounts.clear()
  await clearFirestore()
})

after(async () => {
  await deleteApp(app)
})

describe('subscription lifecycle', () => {
  test('a monthly purchase is Pro, and the webhook record expires', async () => {
    const stripe = new FakeStripe()
    await seedAccount('alice')
    await subscribe(stripe, 'alice')
    const account = (await db.doc('users/alice').get()).data()
    assert.equal(account.tier, 'paid')
    assert.equal(account.subscriptionPlan, 'monthly')
    const events = await db.collection('stripeWebhookEvents').get()
    assert.equal(events.size, 1)
    assertExpiresInDays(events.docs[0].get('expireAt'), 90)
  })

  test('a failed renewal keeps Pro for the grace period, then ends it', async () => {
    const stripe = new FakeStripe()
    await seedAccount('bea')
    const { subscriptionId } = await subscribe(stripe, 'bea')

    const failedAt = Math.floor(Date.now() / 1000)
    await deliver(stripe, stripe.updated(subscriptionId, { status: 'past_due' }, failedAt))
    let account = (await db.doc('users/bea').get()).data()
    assert.equal(account.tier, 'paid')
    assert.equal(account.subscriptionStatus, 'past_due')
    assert.equal(account.pastDueSince.toMillis(), failedAt * 1000)

    // A second failure during the grace period keeps its original start.
    await deliver(stripe, stripe.updated(subscriptionId, { status: 'past_due' }, failedAt + 3600))
    account = (await db.doc('users/bea').get()).data()
    assert.equal(account.pastDueSince.toMillis(), failedAt * 1000)

    // Six days on, still Pro; eight days on, the maintenance job makes it Free.
    assert.deepEqual(
      await endExpiredGracePeriods({ db, now: new Date(failedAt * 1000 + 6 * DAY_MS) }),
      { ended: 0 },
    )
    assert.deepEqual(
      await endExpiredGracePeriods({ db, now: new Date(failedAt * 1000 + 8 * DAY_MS) }),
      { ended: 1 },
    )
    account = (await db.doc('users/bea').get()).data()
    assert.equal(account.tier, 'free')

    // The card is updated and the retry succeeds: Pro again, the grace is cleared.
    await deliver(
      stripe,
      stripe.updated(subscriptionId, { status: 'active' }, failedAt + 9 * 86400),
    )
    account = (await db.doc('users/bea').get()).data()
    assert.equal(account.tier, 'paid')
    assert.equal(account.pastDueSince, null)
  })

  test('a past_due event that arrives after the grace period does not restore Pro', async () => {
    const stripe = new FakeStripe()
    await seedAccount('cy')
    const now = Math.floor(Date.now() / 1000)
    const { subscriptionId } = await subscribe(stripe, 'cy', { created: now - 40 * 86400 })
    const longAgo = now - 10 * 86400
    await deliver(stripe, stripe.updated(subscriptionId, { status: 'past_due' }, longAgo))
    const account = (await db.doc('users/cy').get()).data()
    assert.equal(account.tier, 'free')
    assert.equal(account.subscriptionStatus, 'past_due')
  })

  test('the export carries a billing summary without Stripe identifiers', async () => {
    const stripe = new FakeStripe()
    await seedAccount('dee')
    await subscribe(stripe, 'dee', { plan: 'yearly', trialDays: 7 })
    const exported = await exportAccountData({ auth: auth('dee'), db, req: request() })
    assert.equal(exported.billing.plan, 'pro')
    assert.equal(exported.billing.interval, 'yearly')
    assert.equal(exported.billing.status, 'trialing')
    assert.equal(exported.billing.freeTrialUsed, true)
    assert.match(exported.billing.trialEndsAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.doesNotMatch(JSON.stringify(exported), /cus_test|sub_test|cs_test|pi_test/)
  })
})

describe('the free trial is once per person (REVIEW3 M4)', () => {
  test('a new account for the same Google account gets no second trial after deletion', async () => {
    const stripe = new FakeStripe()
    await seedAccount('ann')
    assert.equal(offeredTrialDays(stripe, await startCheckout(stripe, 'ann')), 7)
    await subscribe(stripe, 'ann', { trialDays: 7, card: 'fp_ann' })
    await deleteAccount({ auth: auth('ann'), db, req: request({ confirmation: 'DELETE' }), stripe })
    await runDeletion(stripe, 'ann')
    assert.equal((await db.doc('users/ann').get()).exists, false)

    // The same person signs in again: a new uid, no Stripe customer, the same Google account.
    googleAccounts.set('ann-again', googleAccount('ann'))
    await seedAccount('ann-again')
    assert.equal(offeredTrialDays(stripe, await startCheckout(stripe, 'ann-again')), undefined)
    // Someone else still gets it.
    await seedAccount('zoe')
    assert.equal(offeredTrialDays(stripe, await startCheckout(stripe, 'zoe')), 7)

    // What is kept is keyed hashes only: no uid, address, Google id, card or Stripe id.
    const history = await db.collection('trialHistory').get()
    assert.deepEqual(history.docs.map(doc => doc.data().kind).sort(), ['card', 'email', 'identity'])
    for (const doc of history.docs) {
      assert.match(doc.id, /^[0-9a-f]{64}$/)
      assert.doesNotMatch(JSON.stringify(doc.data()), /ann|google|example|fp_|sub_|cus_/)
      assertExpiresInDays(doc.data().expireAt, 730)
    }
  })

  test('a verified email that already had a trial gets none on another sign-in', async () => {
    const stripe = new FakeStripe()
    await seedAccount('bea')
    await subscribe(stripe, 'bea', { trialDays: 7 })
    googleAccounts.set('bea-work', { sub: 'google-other', email: 'BEA@example.com ' })
    await seedAccount('bea-work')
    assert.equal(offeredTrialDays(stripe, await startCheckout(stripe, 'bea-work')), undefined)
  })

  test('a card that already had a trial ends the next trial at once', async () => {
    const stripe = new FakeStripe()
    await seedAccount('cal')
    await subscribe(stripe, 'cal', { trialDays: 7, card: 'fp_shared' })
    assert.deepEqual(stripe.subscriptionUpdates, [])

    // Another Google account is offered the trial, but pays with the same card.
    await seedAccount('cal-alt')
    assert.equal(offeredTrialDays(stripe, await startCheckout(stripe, 'cal-alt')), 7)
    const session = (await db.doc('users/cal-alt').get()).data().stripeCheckoutSessionId
    const event = stripe.complete(session, { trialDays: 7, card: 'fp_shared' })
    await deliver(stripe, event)
    const subscriptionId = (await db.doc('users/cal-alt').get()).data().stripeSubscriptionId
    assert.deepEqual(stripe.subscriptionUpdates, [
      {
        id: subscriptionId,
        params: { trial_end: 'now', proration_behavior: 'none' },
        options: { idempotencyKey: `trial-reuse:${subscriptionId}` },
      },
    ])
    assert.equal(stripe.subscriptionsById.get(subscriptionId).status, 'active')
    // A retried event changes nothing more.
    await deliver(stripe, event)
    assert.equal(stripe.subscriptionUpdates.length, 1)

    // A different card keeps its trial.
    await seedAccount('dot')
    await subscribe(stripe, 'dot', { trialDays: 7, card: 'fp_other' })
    assert.equal(stripe.subscriptionUpdates.length, 1)
  })
})

describe('account deletion', () => {
  test('cancels the subscription, deletes the Stripe customer, and leaves only expiring records', async () => {
    const stripe = new FakeStripe()
    await seedAccount('erin')
    const { subscriptionId, customerId } = await subscribe(stripe, 'erin')

    const deletedUsers = []
    await deleteAccount({
      auth: auth('erin', deletedUsers),
      db,
      req: request({ confirmation: 'DELETE' }),
      stripe,
    })
    const tombstone = await runDeletion(stripe, 'erin')

    assert.equal(tombstone.cleanupStatus, 'completed')
    assert.equal(tombstone.cleanupNeedsAttention, false)
    assertExpiresInDays(tombstone.expireAt, 90)
    assert.equal(stripe.subscriptionsById.get(subscriptionId).status, 'canceled')
    assert.deepEqual(stripe.deletedCustomers, [customerId])
    // Deleting your own account cancels without a refund.
    assert.deepEqual(stripe.refundsMade, [])
    assert.equal((await db.doc('users/erin').get()).exists, false)

    const resources = await db
      .collection('accountDeletionTombstones/erin/billingCleanupResources')
      .get()
    assert.ok(resources.size >= 2)
    for (const resource of resources.docs) {
      assert.equal(resource.get('status'), 'completed')
      assertExpiresInDays(resource.get('expireAt'), 90)
    }
    const owners = await db.collection('stripeSubscriptionOwners').where('uid', '==', 'erin').get()
    assert.equal(owners.size, 1)
    assertExpiresInDays(owners.docs[0].get('expireAt'), 90)
  })

  test('finishes when Stripe no longer has the customer or subscription', async () => {
    const stripe = new FakeStripe()
    await seedAccount('finn')
    await subscribe(stripe, 'finn')
    stripe.forget()

    await deleteAccount({
      auth: auth('finn'),
      db,
      req: request({ confirmation: 'DELETE' }),
      stripe,
    })
    const tombstone = await runDeletion(stripe, 'finn')
    assert.equal(tombstone.cleanupStatus, 'completed')
    assert.equal(tombstone.cleanupNeedsAttention, false)
    assert.equal((await db.doc('users/finn').get()).exists, false)
  })

  test('gives up on a resource that keeps failing, alerts, and still deletes the account', async () => {
    const stripe = new FakeStripe()
    await seedAccount('gus')
    const { subscriptionId } = await subscribe(stripe, 'gus')
    stripe.failNext('subscriptions.cancel', 1000)

    await deleteAccount({ auth: auth('gus'), db, req: request({ confirmation: 'DELETE' }), stripe })
    const tombstone = await runDeletion(stripe, 'gus', { maxPages: MAX_RESOURCE_ATTEMPTS * 3 })

    assert.equal(tombstone.cleanupStatus, 'completed')
    assert.equal(tombstone.cleanupNeedsAttention, true)
    assert.equal((await db.doc('users/gus').get()).exists, false)
    const failed = await db
      .collection('accountDeletionTombstones/gus/billingCleanupResources')
      .where('status', '==', 'failed')
      .get()
    assert.equal(failed.size, 1)
    assert.equal(failed.docs[0].get('type'), 'subscription')
    assert.equal(failed.docs[0].get('attemptCount'), MAX_RESOURCE_ATTEMPTS)
    assert.equal(failed.docs[0].get('needsAttention'), true)
    assert.ok(
      logs.entries.some(
        entry =>
          entry.severity === 'ERROR' &&
          entry.message === 'account deletion gave up on a Stripe resource',
      ),
    )
    // The customer is still deleted, which ends the subscription Stripe could not cancel.
    assert.equal(stripe.subscriptionsById.get(subscriptionId).status, 'canceled')
  })
})

const eventKey = index => index.toString(16).padStart(32, '0')

function importedEvent(index) {
  const start = new Date(Date.UTC(2026, 5, 20, 15) + index * 3_600_000)
  return {
    key: eventKey(index),
    source: 'file',
    seriesId: 'fedcba9876543210fedcba9876543210',
    title: `Race ${index}`,
    start: start.toISOString(),
    end: new Date(start.getTime() + 5_400_000).toISOString(),
    timeZone: 'America/Los_Angeles',
    where: 'Griffith Park',
    lat: 34.14,
    lon: -118.29,
    placeLabel: 'Los Angeles, California',
    placeGuessed: false,
    activityId: 'run',
    url: '',
    createdAt: '2026-06-15T17:30:00.000Z',
    updatedAt: '2026-06-15T17:30:00.000Z',
  }
}

function scheduledActivity(index) {
  const eventId = `evt${String(index).padStart(5, '0')}`
  return {
    eventId,
    calendarId: 'primary',
    activityId: 'run',
    title: 'Running: lower-UV window',
    icon: '🏃',
    start: '2026-06-16T01:00:00.000Z',
    end: '2026-06-16T01:45:00.000Z',
    timeZone: 'America/Los_Angeles',
    htmlLink: `https://www.google.com/calendar/event?eid=${eventId}`,
    createdAt: '2026-06-15T17:30:00.000Z',
    updatedAt: '2026-06-15T17:30:00.000Z',
  }
}

/** Writes `count` events and scheduled activities straight to Firestore, as a script could. */
async function seedCollections(uid, { events = 0, scheduled = 0, junk = 0 }) {
  const writes = [
    ...Array.from({ length: events }, (_, index) => [
      `users/${uid}/events/${eventKey(index)}`,
      { ...importedEvent(index), expireAt: new Date(Date.now() + 30 * DAY_MS) },
    ]),
    ...Array.from({ length: scheduled }, (_, index) => {
      const item = scheduledActivity(index)
      return [`users/${uid}/scheduled/${item.eventId}`, item]
    }),
    // Records that fail the schema are read (and counted) but never exported.
    ...Array.from({ length: junk }, (_, index) => [
      `users/${uid}/events/${'f'.repeat(24)}${String(index).padStart(8, '0')}`,
      { title: 'not an event' },
    ]),
  ]
  for (let start = 0; start < writes.length; start += 500) {
    const batch = db.batch()
    for (const [path, data] of writes.slice(start, start + 500)) batch.set(db.doc(path), data)
    await batch.commit()
  }
}

/** Records the size of every query the export's transaction runs. */
function countingDb() {
  const queries = []
  const counting = Object.create(db)
  counting.runTransaction = (work, options) =>
    db.runTransaction(async transaction => {
      const get = transaction.get.bind(transaction)
      const wrapped = Object.create(transaction)
      wrapped.get = async ref => {
        const result = await get(ref)
        if (result.docs) queries.push(result.docs.length)
        return result
      }
      return work(wrapped)
    }, options)
  return { counting, queries }
}

describe('the account export pages large collections (REVIEW4 M4)', () => {
  test('reads every event and scheduled activity in pages from one read-only snapshot', async () => {
    await seedAccount('page')
    await seedCollections('page', { events: 1250, scheduled: 230 })
    const { counting, queries } = countingDb()
    const exported = await exportAccountData({
      auth: auth('page'),
      db: counting,
      req: request(),
    })
    assert.equal(exported.importedEvents.length, 1250)
    assert.deepEqual(exported.importedEvents[1249], importedEvent(1249))
    assert.equal(exported.scheduledActivities.length, 230)
    assert.deepEqual(exported.truncated, [])
    // No query reads more than a page: 7 for the events, 2 for scheduled, 1 for devices.
    assert.ok(
      queries.every(size => size <= 200),
      `page sizes ${queries}`,
    )
    assert.equal(queries.length, 10)
  })

  test('stops at the collection limit and says which sections were cut short', async () => {
    await seedAccount('cap')
    await seedCollections('cap', { events: 40, scheduled: 25, junk: 30 })
    const exported = await exportAccountData({
      auth: auth('cap'),
      db,
      req: request(),
      limits: { pageSize: 10, collectionLimit: 50 },
    })
    // Junk sorts after the events, so the 50 documents read are 40 events and 10 junk.
    assert.equal(exported.importedEvents.length, 40)
    assert.equal(exported.scheduledActivities.length, 25)
    assert.deepEqual(exported.truncated, ['importedEvents'])
  })

  test('an exact page boundary is not truncated', async () => {
    await seedAccount('edge')
    await seedCollections('edge', { events: 20 })
    const exported = await exportAccountData({
      auth: auth('edge'),
      db,
      req: request(),
      limits: { pageSize: 10, collectionLimit: 20 },
    })
    assert.equal(exported.importedEvents.length, 20)
    assert.deepEqual(exported.truncated, [])
  })
})

describe('account deletion removes what the person added (REVIEW4 L4)', () => {
  test('imported, Google and Outlook events, their connections, scheduled activities and devices go with the account', async () => {
    const stripe = new FakeStripe()
    await seedAccount('gus')
    await seedCollections('gus', { events: 620, scheduled: 12 })
    await db.doc('users/gus/notificationDevices/device-1').set({ enabled: true, platform: 'web' })
    // Events from Google Calendar and Outlook, and the calendars chosen for each.
    const connection = { calendars: [{ id: 'default', name: '' }], connectedAt: '', syncedAt: '' }
    await db.doc('users/gus/meta/googleCalendar').set(connection)
    await db.doc('users/gus/meta/outlookCalendar').set(connection)
    for (const [index, source] of [
      [700, 'google'],
      [701, 'outlook'],
    ]) {
      await db
        .doc(`users/gus/events/${eventKey(index)}`)
        .set({ ...importedEvent(index), source, expireAt: new Date(Date.now() + 30 * DAY_MS) })
    }
    await deleteAccount({ auth: auth('gus'), db, req: request({ confirmation: 'DELETE' }), stripe })
    await runDeletion(stripe, 'gus')
    for (const collection of ['events', 'scheduled', 'notificationDevices', 'meta']) {
      const left = await db.collection(`users/gus/${collection}`).count().get()
      assert.equal(left.data().count, 0, `${collection} deleted`)
    }
    assert.equal((await db.doc('users/gus').get()).exists, false)
  })
})
