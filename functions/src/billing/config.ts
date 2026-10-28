// Stripe configuration: secrets live in Secret Manager, the price ids and the billing
// switch in functions/.env* (the deploy job writes them from repository variables).

import type { BillingPlan } from '#core'
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params'
import Stripe from 'stripe'

export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
/**
 * The HMAC key of the trial history (trial-history.ts): random, at least 32 bytes, never
 * rotated (a new key forgets every recorded trial) unless it leaks.
 */
export const TRIAL_HISTORY_KEY = defineSecret('TRIAL_HISTORY_KEY')
/** The monthly Pro price ($2.99). */
export const STRIPE_PRICE_ID = defineString('STRIPE_PRICE_ID', { default: '' })
/** The yearly Pro price ($19.99). */
export const STRIPE_YEARLY_PRICE_ID = defineString('STRIPE_YEARLY_PRICE_ID', { default: '' })
/**
 * Whether new subscriptions may be sold. Off until the owner switches billing on (the
 * BILLING_ENABLED repository variable), so deployed Functions never sell early; the
 * webhook, the portal and deletion work either way.
 */
export const BILLING_ENABLED = defineBoolean('BILLING_ENABLED', { default: false })

/** The Pro price id of each plan. */
export type BillingPrices = Record<BillingPlan, string>

export function billingPrices(): BillingPrices {
  return { monthly: STRIPE_PRICE_ID.value(), yearly: STRIPE_YEARLY_PRICE_ID.value() }
}

/** Every configured Pro price id; a subscription to any of them is Pro. */
export function proPriceIds(prices: BillingPrices = billingPrices()): string[] {
  return [prices.monthly, prices.yearly].filter(Boolean)
}

// Pin the Stripe API version instead of following whatever the SDK defaults
// to. The SDK types are generated for exactly this version and the config type
// only accepts it, so an SDK upgrade that moves the API version fails the
// typecheck here until the new version's changes are reviewed. The webhook
// endpoint must use the same version, so event payloads match these types.
export const STRIPE_API_VERSION = '2026-09-30.endive' satisfies Stripe.LatestApiVersion

/**
 * The Stripe client. Only inside the Functions emulator may STRIPE_API_BASE point it at
 * a local fake Stripe (the signed-in e2e suite, tests/e2e/signed-in/fake-stripe.mjs);
 * a deployed function always talks to api.stripe.com.
 */
export function stripeClient(): Stripe {
  const base = process.env.FUNCTIONS_EMULATOR === 'true' ? process.env.STRIPE_API_BASE : undefined
  if (base) {
    const url = new URL(base)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('STRIPE_API_BASE must be a loopback address')
    }
    return new Stripe(STRIPE_SECRET_KEY.value(), {
      apiVersion: STRIPE_API_VERSION,
      host: url.hostname,
      port: Number(url.port),
      protocol: 'http',
      maxNetworkRetries: 0,
    })
  }
  return new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: STRIPE_API_VERSION })
}
