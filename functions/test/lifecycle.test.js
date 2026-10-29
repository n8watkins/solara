// Account and subscription lifecycle: refunds for server-initiated cancellations, and
// refunds or disputes that end the subscription they paid for.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  cancelAndRefund,
  endSubscriptionForReversedPayment,
  refundSubscriptionPayments,
} = require('../lib/billing/refunds')
const { processStripeEvent } = require('../lib/billing/webhook')

function stripeError(code) {
  return Object.assign(new Error(code), { code })
}

/** A Stripe fake with one subscription and the invoices that paid for it. */
function fakeStripe({
  subscription,
  invoices = [],
  paymentsByInvoice = {},
  invoiceForIntent = {},
}) {
  const calls = { canceled: [], refunds: [] }
  return {
    calls,
    subscriptions: {
      retrieve: async id => {
        if (!subscription || subscription.id !== id) throw stripeError('resource_missing')
        return subscription
      },
      cancel: async id => {
        calls.canceled.push(id)
        subscription.status = 'canceled'
        return subscription
      },
    },
    invoices: { list: async () => ({ data: invoices, has_more: false }) },
    invoicePayments: {
      list: async params => {
        if (params.invoice) return { data: paymentsByInvoice[params.invoice] ?? [] }
        const invoice = invoiceForIntent[params.payment.payment_intent]
        return { data: invoice ? [{ invoice }] : [] }
      },
    },
    refunds: {
      create: async (params, options) => {
        if (
          calls.refunds.some(refund => refund.options.idempotencyKey === options.idempotencyKey)
        ) {
          throw stripeError('charge_already_refunded')
        }
        calls.refunds.push({ params, options })
        return { id: `re_${calls.refunds.length}` }
      },
    },
  }
}

const payment = intent => ({ payment: { type: 'payment_intent', payment_intent: intent } })

describe('refunds for server-initiated cancellations', () => {
  test('cancels and refunds every paid payment once, however often it runs', async () => {
    const stripe = fakeStripe({
      subscription: { id: 'sub_loser', status: 'active', metadata: { firebaseUid: 'alice' } },
      invoices: [
        { id: 'in_paid', amount_paid: 299 },
        { id: 'in_trial', amount_paid: 0 },
      ],
      paymentsByInvoice: { in_paid: [payment('pi_1')], in_trial: [payment('pi_trial')] },
    })
    assert.deepEqual(await cancelAndRefund(stripe, 'sub_loser', 'duplicate-checkout'), {
      refunded: 1,
    })
    assert.deepEqual(stripe.calls.canceled, ['sub_loser'])
    assert.deepEqual(stripe.calls.refunds, [
      {
        params: {
          payment_intent: 'pi_1',
          reason: 'duplicate',
          metadata: { solaraReason: 'duplicate-checkout', subscriptionId: 'sub_loser' },
        },
        options: { idempotencyKey: 'refund:pi_1' },
      },
    ])
    // A retry neither cancels again nor refunds twice.
    assert.deepEqual(await cancelAndRefund(stripe, 'sub_loser', 'duplicate-checkout'), {
      refunded: 0,
    })
    assert.deepEqual(stripe.calls.canceled, ['sub_loser'])
    assert.equal(stripe.calls.refunds.length, 1)
  })

  test('treats a subscription Stripe no longer has as done', async () => {
    const stripe = fakeStripe({ subscription: null })
    assert.deepEqual(await cancelAndRefund(stripe, 'sub_gone', 'account-deleted'), { refunded: 0 })
    assert.deepEqual(stripe.calls.canceled, [])
  })

  test('refunds a trial that was never charged with nothing', async () => {
    const stripe = fakeStripe({ subscription: { id: 'sub_trial', status: 'trialing' } })
    assert.equal(await refundSubscriptionPayments(stripe, 'sub_trial', 'account-deleted'), 0)
  })
})

describe('refunds and disputes end the subscription they paid for', () => {
  const invoiceFor = subscription => ({
    id: 'in_1',
    parent: { type: 'subscription_details', subscription_details: { subscription } },
  })

  function chargeRefunded(overrides = {}) {
    return {
      id: 'evt_refund',
      created: 500,
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, ...overrides } },
    }
  }

  test('a full refund cancels the live Pro subscription it paid for', async () => {
    const stripe = fakeStripe({
      subscription: { id: 'sub_pro', status: 'active', metadata: { firebaseUid: 'alice' } },
      invoiceForIntent: { pi_1: invoiceFor('sub_pro') },
    })
    assert.equal(await endSubscriptionForReversedPayment(stripe, chargeRefunded()), 'sub_pro')
    assert.deepEqual(stripe.calls.canceled, ['sub_pro'])
  })

  test('a dispute cancels it too', async () => {
    const stripe = fakeStripe({
      subscription: { id: 'sub_pro', status: 'past_due', metadata: { firebaseUid: 'alice' } },
      invoiceForIntent: { pi_9: invoiceFor('sub_pro') },
    })
    const dispute = {
      id: 'evt_dispute',
      created: 500,
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', charge: 'ch_9', payment_intent: 'pi_9' } },
    }
    assert.equal(await endSubscriptionForReversedPayment(stripe, dispute), 'sub_pro')
  })

  test('leaves partial refunds, other payments and ended subscriptions alone', async () => {
    const live = () => ({ id: 'sub_pro', status: 'active', metadata: { firebaseUid: 'alice' } })
    const partial = fakeStripe({
      subscription: live(),
      invoiceForIntent: { pi_1: invoiceFor('sub_pro') },
    })
    assert.equal(
      await endSubscriptionForReversedPayment(partial, chargeRefunded({ refunded: false })),
      null,
    )
    const unrelated = fakeStripe({ subscription: live() })
    assert.equal(await endSubscriptionForReversedPayment(unrelated, chargeRefunded()), null)
    // After the server's own refund the subscription has already ended.
    const ended = fakeStripe({
      subscription: { ...live(), status: 'canceled' },
      invoiceForIntent: { pi_1: invoiceFor('sub_pro') },
    })
    assert.equal(await endSubscriptionForReversedPayment(ended, chargeRefunded()), null)
    // A subscription Solara did not create is not touched.
    const foreign = fakeStripe({
      subscription: { id: 'sub_pro', status: 'active', metadata: {} },
      invoiceForIntent: { pi_1: invoiceFor('sub_pro') },
    })
    assert.equal(await endSubscriptionForReversedPayment(foreign, chargeRefunded()), null)
    for (const stripe of [partial, unrelated, ended, foreign]) {
      assert.deepEqual(stripe.calls.canceled, [])
    }
  })

  test('the webhook records the event once and reports what it ended', async () => {
    const events = new Map()
    const db = {
      collection(name) {
        assert.equal(name, 'stripeWebhookEvents')
        return { doc: id => ({ id }) }
      },
      async runTransaction(callback) {
        return callback({
          get: async ref => ({ exists: events.has(ref.id), data: () => events.get(ref.id) }),
          create: (ref, data) => events.set(ref.id, data),
          set: (ref, data) => events.set(ref.id, { ...events.get(ref.id), ...data }),
        })
      },
    }
    const stripe = fakeStripe({
      subscription: { id: 'sub_pro', status: 'active', metadata: { firebaseUid: 'alice' } },
      invoiceForIntent: { pi_1: invoiceFor('sub_pro') },
    })
    const options = {
      db,
      event: chargeRefunded(),
      prices: { monthly: 'price_pro', yearly: 'price_pro_yearly' },
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    }
    const first = await processStripeEvent(options)
    assert.equal(first.endedSubscriptionId, 'sub_pro')
    assert.equal(first.duplicate, false)
    const second = await processStripeEvent(options)
    assert.equal(second.duplicate, true)
    assert.equal(second.endedSubscriptionId, null)
    assert.equal(events.get('evt_refund').expireAt instanceof Date, true)
  })
})

describe('billing summary in the account export', () => {
  const { billingSummary } = require('../lib/account/export')
  const at = iso => ({ toMillis: () => Date.parse(iso) })

  test('says what the subscription is, with dates and no Stripe identifiers', () => {
    const summary = billingSummary({
      tier: 'paid',
      proSince: at('2026-10-01T00:00:00Z'),
      subscriptionPlan: 'yearly',
      subscriptionStatus: 'past_due',
      subscriptionTrialEnd: null,
      subscriptionCurrentPeriodEnd: at('2027-10-01T00:00:00Z'),
      subscriptionCancelAtPeriodEnd: false,
      pastDueSince: at('2026-10-20T00:00:00Z'),
      stripeTrialUsed: true,
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
      stripeCheckoutSessionId: 'cs_secret',
    })
    assert.deepEqual(summary, {
      plan: 'pro',
      provider: 'stripe',
      interval: 'yearly',
      status: 'past_due',
      proSince: '2026-10-01T00:00:00.000Z',
      trialEndsAt: null,
      currentPeriodEndsAt: '2027-10-01T00:00:00.000Z',
      cancelsAtPeriodEnd: false,
      paymentFailedSince: '2026-10-20T00:00:00.000Z',
      freeTrialUsed: true,
    })
    assert.doesNotMatch(JSON.stringify(summary), /secret|cus_|sub_|cs_/)
  })

  test('is a plain Free summary for an account that never paid', () => {
    assert.deepEqual(billingSummary(null), {
      plan: 'free',
      provider: 'stripe',
      interval: null,
      status: null,
      proSince: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelsAtPeriodEnd: false,
      paymentFailedSince: null,
      freeTrialUsed: false,
    })
  })
})

describe('past_due grace period', () => {
  const { PAST_DUE_GRACE_DAYS, pastDueSince, withinGrace } = require('../lib/billing/grace')

  test('counts from the first failed renewal and lasts a week', () => {
    assert.equal(PAST_DUE_GRACE_DAYS, 7)
    const first = pastDueSince({ subscriptionStatus: 'active' }, 1_000)
    assert.equal(first.getTime(), 1_000_000)
    // A later past_due event keeps the original start.
    const stored = { subscriptionStatus: 'past_due', pastDueSince: { toMillis: () => 1_000_000 } }
    assert.equal(pastDueSince(stored, 9_000).getTime(), 1_000_000)
    const day = 24 * 60 * 60 * 1000
    assert.equal(withinGrace(first, first.getTime() + 7 * day - 1), true)
    assert.equal(withinGrace(first, first.getTime() + 7 * day), false)
  })
})
