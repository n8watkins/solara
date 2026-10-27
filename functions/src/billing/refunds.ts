// Refunds and payment reversals.
//
// Policy (docs/DEPLOYMENT.md, "Refunds and disputes"):
// - When the server itself cancels a subscription the customer did not mean to keep
//   paying for (a losing duplicate checkout, a checkout that completed while its account
//   was being deleted or could not be recorded), every payment on it is refunded in full.
// - A person deleting their own account cancels the subscription without a refund, as a
//   cancellation in the portal would (Pro ends at once instead of at the period end).
// - A full refund issued in Stripe, or a dispute, ends the subscription it paid for, so
//   Pro never outlives the money.

import type Stripe from 'stripe'

import { errorCode } from '../shared/errors'
import { TERMINAL_SUBSCRIPTION_STATUSES, stringId } from './ids'

export type ServerCancellationReason =
  'duplicate-checkout' | 'account-deleted' | 'checkout-not-recorded'

/** Refunds every paid invoice payment of a subscription; returns how many were refunded. */
export async function refundSubscriptionPayments(
  stripe: Stripe,
  subscriptionId: string,
  reason: ServerCancellationReason,
): Promise<number> {
  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    status: 'paid',
    limit: 100,
  })
  let refunded = 0
  for (const invoice of invoices.data) {
    if (!invoice.id || !(invoice.amount_paid > 0)) continue
    const payments = await stripe.invoicePayments.list({
      invoice: invoice.id,
      status: 'paid',
      limit: 100,
    })
    for (const payment of payments.data) {
      const paymentIntent = stringId(payment.payment?.payment_intent)
      if (!paymentIntent) continue
      try {
        await stripe.refunds.create(
          {
            payment_intent: paymentIntent,
            ...(reason === 'duplicate-checkout' ? { reason: 'duplicate' as const } : {}),
            metadata: { solaraReason: reason, subscriptionId },
          },
          // One refund per payment, however often this runs.
          { idempotencyKey: `refund:${paymentIntent}` },
        )
        refunded += 1
      } catch (error) {
        if (errorCode(error) !== 'charge_already_refunded') throw error
      }
    }
  }
  return refunded
}

/**
 * Cancels a subscription the server decided must not run, then refunds what it took.
 * Safe to repeat: a missing or already ended subscription is not canceled again, and
 * refunds are idempotent per payment.
 */
export async function cancelAndRefund(
  stripe: Stripe,
  subscriptionId: string,
  reason: ServerCancellationReason,
): Promise<{ refunded: number }> {
  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    if (errorCode(error) === 'resource_missing') return { refunded: 0 }
    throw error
  }
  if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    try {
      await stripe.subscriptions.cancel(subscriptionId)
    } catch (error) {
      if (errorCode(error) !== 'resource_missing') throw error
    }
  }
  return { refunded: await refundSubscriptionPayments(stripe, subscriptionId, reason) }
}

/** The subscription a payment paid for, through its invoice, or null. */
export async function subscriptionForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
    expand: ['data.invoice'],
  })
  const invoice = payments.data[0]?.invoice
  if (!invoice || typeof invoice === 'string' || !('parent' in invoice)) return null
  return stringId(invoice.parent?.subscription_details?.subscription)
}

/**
 * Ends the Pro subscription a fully refunded or disputed payment paid for. Returns the
 * subscription it canceled, or null when there was nothing live to end (a partial
 * refund, a payment that was not for Pro, or a subscription that already ended, as
 * after the server's own refunds).
 */
export async function endSubscriptionForReversedPayment(
  stripe: Stripe,
  event: Stripe.ChargeRefundedEvent | Stripe.ChargeDisputeCreatedEvent,
): Promise<string | null> {
  let paymentIntent: string | null
  if (event.type === 'charge.refunded') {
    const charge = event.data.object
    if (!charge.refunded) return null
    paymentIntent = stringId(charge.payment_intent)
  } else {
    paymentIntent = stringId(event.data.object.payment_intent)
  }
  if (!paymentIntent) return null
  const subscriptionId = await subscriptionForPaymentIntent(stripe, paymentIntent)
  if (!subscriptionId) return null
  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    if (errorCode(error) === 'resource_missing') return null
    throw error
  }
  if (TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) return null
  if (!subscription.metadata?.firebaseUid) return null
  try {
    await stripe.subscriptions.cancel(subscriptionId)
  } catch (error) {
    if (errorCode(error) !== 'resource_missing') throw error
  }
  // The customer.subscription.deleted event that follows takes Pro away.
  return subscriptionId
}
