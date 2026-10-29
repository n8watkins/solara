// Billing Cloud Functions: checkout, the billing portal and the Stripe webhook. The
// scheduled billing work runs in the maintenance job (ops/functions.ts).

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import Stripe from 'stripe'

import { maxBodyBytesFor } from '../shared/body-limit'
import { appOrigin, browserApi } from '../shared/browser-api'
import { loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'
import { db, serverTimestamp } from '../shared/firebase'
import { clientAddress, requestBodyBytes, setApiHeaders } from '../shared/http'
import { httpOptions } from '../shared/options'
import { FixedWindowLimiter } from '../shared/rate-limit'
import { createBillingPortal, createCheckout } from './checkout'
import {
  BILLING_ENABLED,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  TRIAL_HISTORY_KEY,
  billingPrices,
  stripeClient,
} from './config'
import { TrialHistory } from './trial-history'
import { processStripeEvent } from './webhook'

export const createCheckoutSession = onRequest(
  httpOptions({
    name: 'createCheckoutSession',
    timeoutSeconds: 30,
    secrets: [STRIPE_SECRET_KEY, TRIAL_HISTORY_KEY],
  }),
  browserApi({
    name: 'createCheckoutSession',
    method: 'POST',
    appCheckMode: 'limited-use',
    fallbackMessage: 'Checkout unavailable',
    handler: async req => {
      const session = await createCheckout({
        appUrl: appOrigin(),
        auth: getAuth(),
        billingEnabled: BILLING_ENABLED.value(),
        db,
        prices: billingPrices(),
        req,
        stripe: stripeClient(),
        trialHistory: new TrialHistory(db, TRIAL_HISTORY_KEY.value()),
      })
      // Hosted Checkout always has a URL; without one the browser has nowhere to go.
      if (!session.url) throw new Error('Checkout session has no URL')
      return { body: { url: session.url } }
    },
  }),
)

export const createBillingPortalSession = onRequest(
  httpOptions({
    name: 'createBillingPortalSession',
    timeoutSeconds: 30,
    secrets: [STRIPE_SECRET_KEY],
  }),
  browserApi({
    name: 'createBillingPortalSession',
    method: 'POST',
    appCheckMode: 'standard',
    fallbackMessage: 'Billing management unavailable',
    handler: async req => {
      const session = await createBillingPortal({
        appUrl: appOrigin(),
        auth: getAuth(),
        db,
        req,
        stripe: stripeClient(),
      })
      return { body: { url: session.url } }
    },
  }),
)

/** Stripe's event payloads are a few KiB; anything far larger is not from Stripe. */
const WEBHOOK_MAX_BODY_BYTES = maxBodyBytesFor('stripeWebhook')
/**
 * Stripe sends from a few addresses, far fewer than one event a second each, and retries
 * a refused delivery with backoff for three days; so this only stops a flood of forged
 * requests, each of which would otherwise cost a signature check (REVIEW8 SEC L2).
 */
const WEBHOOK_PER_ADDRESS_PER_MINUTE = 60
const webhookLimiter = new FixedWindowLimiter({
  limit: WEBHOOK_PER_ADDRESS_PER_MINUTE,
  windowMs: 60_000,
})
/** Forged requests are logged once a minute per kind, with the count held back. */
const webhookRejections = new ThrottledLog()

// Not App Check: Stripe calls it, and every request must carry a valid Stripe signature.
// Everything before the signature check runs in memory and logs at most a line a minute,
// so a flood of forged posts stays cheap; the Stripe client is built only for a verified
// event.
export const stripeWebhook = onRequest(
  httpOptions({
    name: 'stripeWebhook',
    timeoutSeconds: 60,
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TRIAL_HISTORY_KEY],
  }),
  async (req, res) => {
    setApiHeaders(res)
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      res.status(405).json({ error: 'Method Not Allowed' })
      return
    }
    if (!webhookLimiter.take(clientAddress(req)).allowed) {
      webhookRejections.log('warn', '429', 'stripeWebhook rate limited', { status: 429 })
      res.set('Retry-After', '60')
      res.status(429).json({ error: 'Too many requests' })
      return
    }
    if (requestBodyBytes(req) > WEBHOOK_MAX_BODY_BYTES) {
      webhookRejections.log('warn', '413', 'stripeWebhook body too large', { status: 413 })
      res.status(413).json({ error: 'Request too large' })
      return
    }

    const signature = req.headers['stripe-signature']
    let event: Stripe.Event
    try {
      if (typeof signature !== 'string') throw new Error('Missing Stripe signature')
      event = Stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value())
    } catch (error) {
      webhookRejections.log('warn', '400', 'stripeWebhook signature rejected', {
        status: 400,
        error: loggableError(error),
      })
      res.status(400).json({ error: 'Invalid signature' })
      return
    }

    const stripe = stripeClient()
    try {
      const result = await processStripeEvent({
        auth: getAuth(),
        db,
        event,
        prices: billingPrices(),
        serverTimestamp,
        stripe,
        trialHistory: new TrialHistory(db, TRIAL_HISTORY_KEY.value()),
      })
      const duplicate = 'duplicate' in result && result.duplicate === true
      logger.info('stripeWebhook processed', { eventId: event.id, eventType: event.type, result })
      res.status(200).json({ received: true, duplicate })
    } catch (error) {
      logger.error('stripeWebhook failed', {
        eventId: event.id,
        eventType: event.type,
        error: loggableError(error),
      })
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  },
)
