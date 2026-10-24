// Stripe configuration: secrets live in Secret Manager, the price id in functions/.env*.

import { defineSecret, defineString } from 'firebase-functions/params'
import Stripe from 'stripe'

export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
export const STRIPE_PRICE_ID = defineString('STRIPE_PRICE_ID', { default: '' })

// Pin the Stripe API version instead of following whatever the SDK defaults
// to. The SDK types are generated for exactly this version and the config type
// only accepts it, so an SDK upgrade that moves the API version fails the
// typecheck here until the new version's changes are reviewed. The webhook
// endpoint must use the same version, so event payloads match these types.
export const STRIPE_API_VERSION = '2026-09-30.endive' satisfies Stripe.LatestApiVersion

export function stripeClient(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: STRIPE_API_VERSION })
}
