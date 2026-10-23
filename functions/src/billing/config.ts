// Stripe configuration: secrets live in Secret Manager, the price id in functions/.env*.

import { defineSecret, defineString } from 'firebase-functions/params'
import Stripe from 'stripe'

export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
export const STRIPE_PRICE_ID = defineString('STRIPE_PRICE_ID', { default: '' })

export function stripeClient(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value())
}
