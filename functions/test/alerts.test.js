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
