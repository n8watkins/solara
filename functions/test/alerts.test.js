// Pro alerts without Firestore: who is entitled, when an alert may be sent again, the
// runtime identity setting and the scheduled job's switches. The full runs are in
// test/emulator/alerts.test.js.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { hasProEntitlement } = require('../lib/billing/entitlement')
const {
  ALERT_MAX_ATTEMPTS,
  alertDayHours,
  canSend,
  deliveryKey,
  deliveryScope,
  planHeadsUpLookups,
} = require('../lib/notifications/alerts')
const { alertsServiceAccount } = require('../lib/notifications/config')

const NOW = Date.parse('2026-06-15T12:00:00Z')
const DAY = 86_400_000

describe('Pro entitlement', () => {
  test('active and trialing subscriptions have Pro', () => {
    for (const subscriptionStatus of ['active', 'trialing']) {
      assert.equal(hasProEntitlement({ tier: 'paid', subscriptionStatus }, NOW), true)
    }
  })

  test('past_due keeps Pro for the grace period only', () => {
    const user = since => ({
      tier: 'paid',
      subscriptionStatus: 'past_due',
      pastDueSince: new Date(NOW - since),
    })
    assert.equal(hasProEntitlement(user(6 * DAY), NOW), true)
    assert.equal(hasProEntitlement(user(7 * DAY), NOW), false)
    assert.equal(hasProEntitlement({ tier: 'paid', subscriptionStatus: 'past_due' }, NOW), false)
  })

  test('a stale tier behind an ended subscription has no Pro', () => {
    for (const subscriptionStatus of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
      assert.equal(hasProEntitlement({ tier: 'paid', subscriptionStatus }, NOW), false)
    }
  })

  test('Pro granted by hand has no subscription; Free and deleting accounts never have Pro', () => {
    assert.equal(hasProEntitlement({ tier: 'paid' }, NOW), true)
    assert.equal(hasProEntitlement({ tier: 'free', subscriptionStatus: 'active' }, NOW), false)
    assert.equal(
      hasProEntitlement(
        { tier: 'paid', subscriptionStatus: 'active', accountDeletionStartedAt: new Date(NOW) },
        NOW,
      ),
      false,
    )
    assert.equal(hasProEntitlement(undefined, NOW), false)
  })
})

describe('alert state', () => {
  const day = '2026-06-15'

  test('a new day may always be sent', () => {
    assert.equal(canSend(undefined, 'morning', day), true)
    assert.equal(
      canSend({ morning: { day: '2026-06-14', status: 'delivered' } }, 'morning', day),
      true,
    )
    assert.equal(canSend({ uv: { day, status: 'delivered' } }, 'morning', day), true)
  })

  test('the same day is sent at most once, unless it failed for certain', () => {
    for (const status of ['claimed', 'delivered', 'unknown']) {
      assert.equal(canSend({ morning: { day, status, attempts: 1 } }, 'morning', day), false)
    }
    assert.equal(canSend({ morning: { day, status: 'failed', attempts: 1 } }, 'morning', day), true)
    assert.equal(
      canSend({ morning: { day, status: 'failed', attempts: ALERT_MAX_ATTEMPTS } }, 'morning', day),
      false,
    )
  })

  test('delivery keys name the kind and day; scopes are per account and opaque', () => {
    assert.equal(deliveryKey('uv', day), 'uv-v1:2026-06-15')
    assert.equal(deliveryScope('alice'), deliveryScope('alice'))
    assert.notEqual(deliveryScope('alice'), deliveryScope('bob'))
    assert.doesNotMatch(deliveryScope('alice'), /alice/)
  })
})

describe('alerts runtime identity', () => {
  test('keeps the default identity until ALERTS_SERVICE_ACCOUNT names one', () => {
    assert.equal(alertsServiceAccount({}), undefined)
    assert.equal(alertsServiceAccount({ ALERTS_SERVICE_ACCOUNT: '  ' }), undefined)
    assert.equal(
      alertsServiceAccount({ ALERTS_SERVICE_ACCOUNT: 'solara-alerts@p.iam.gserviceaccount.com' }),
      'solara-alerts@p.iam.gserviceaccount.com',
    )
  })
})

describe('morning alert forecast', () => {
  test('carries the clear-sky UV, so the alert plans like the app', () => {
    const hours = alertDayHours(
      {
        hourly: {
          time: ['2026-06-15T05:00', '2026-06-15T09:00', '2026-06-15T10:00'],
          uv_index: [0, 3.5, 5],
          uv_index_clear_sky: [0, 6, null],
        },
      },
      '2026-06-15',
    )
    assert.deepEqual(hours, [
      { hour: 9, uv: 3.5, clearSkyUV: 6 },
      { hour: 10, uv: 5 },
    ])
  })
})

describe('event forecast lookups shared out among heads-ups (REVIEW6 M1)', () => {
  /** A run's planning side: the caps and the places planned so far. */
  function fakeRun({ perRun = 200, perAccount = 10, known = [] } = {}) {
    const planned = new Set(known)
    const cell = place => `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`
    return {
      limits: { maxEventForecasts: perRun, maxEventForecastsPerAccount: perAccount },
      planned,
      eventPlaceKnown: place => planned.has(cell(place)),
      planEventLookup(place) {
        if (planned.size - known.length >= perRun) return false
        planned.add(cell(place))
        return true
      },
    }
  }
  /** An account's candidates: `count` events from `firstStart` minutes on, each at its own place. */
  const job = (count, { firstStart = 0, lat = 10, sharedPlace = false } = {}) => ({
    looked: 0,
    candidates: Array.from({ length: count }, (_, n) => ({
      startMs: (firstStart + n) * 60_000,
      lat: sharedPlace ? lat : lat + n * 0.02,
      lon: 20,
    })),
  })

  test('an account looks up at most 10 places, its soonest events first', () => {
    const run = fakeRun()
    const greedy = job(200)
    planHeadsUpLookups(run, [greedy])
    assert.equal(greedy.looked, 10)
    assert.equal(run.planned.size, 10)
  })

  test('the run cap goes one per account per round, so no account starves another', () => {
    const run = fakeRun({ perRun: 30 })
    // Ten accounts want 20 places each; the last account wants one, for a later event.
    const greedy = Array.from({ length: 10 }, (_, a) => job(20, { lat: 10 + a }))
    const victim = job(1, { firstStart: 60, lat: 40 })
    planHeadsUpLookups(run, [...greedy, victim])
    assert.equal(victim.looked, 1)
    assert.equal(run.planned.size, 30)
    for (const account of greedy) assert.ok(account.looked >= 2 && account.looked <= 3)
  })

  test('within a round, the account whose next event starts soonest goes first', () => {
    const run = fakeRun({ perRun: 2 })
    const late = job(1, { firstStart: 120, lat: 50 })
    const soon = job(1, { firstStart: 30, lat: 60 })
    const soonest = job(1, { firstStart: 0, lat: 70 })
    planHeadsUpLookups(run, [late, soon, soonest])
    assert.deepEqual([late.looked, soon.looked, soonest.looked], [0, 1, 1])
  })

  test('places already looked up in the run are free and do not count', () => {
    // The home forecast of the run already holds 10.00,20.00; 30 events at one park.
    const run = fakeRun({ perRun: 1, known: ['10.00,20.00'] })
    const park = job(30, { sharedPlace: true })
    const other = job(3, { lat: 30, sharedPlace: true })
    planHeadsUpLookups(run, [park, other])
    assert.equal(park.looked, 30)
    // One new place for the other account (its three events share it), then the run is full.
    assert.equal(other.looked, 3)
  })
})
