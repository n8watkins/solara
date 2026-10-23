// Billing Cloud Functions: checkout, the billing portal, the Stripe webhook and the
// scheduled billing maintenance jobs.

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import type Stripe from 'stripe'

import { appOrigin, browserApi } from '../shared/browser-api'
import { loggableError } from '../shared/errors'
import { db, serverTimestamp } from '../shared/firebase'
import { setApiHeaders } from '../shared/http'
import { type BackfillResult, backfillBillingResourcePage } from './backfill'
import { createBillingPortal, createCheckout, processPendingCheckoutCleanups } from './checkout'
import { STRIPE_PRICE_ID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, stripeClient } from './config'
import { processStripeEvent } from './webhook'

/** Each scheduled run walks at most this many backfill pages. */
const BACKFILL_PAGES_PER_RUN = 20

export const createCheckoutSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'createCheckoutSession',
    method: 'POST',
    appCheckMode: 'limited-use',
    fallbackMessage: 'Checkout unavailable',
    handler: async req => {
      const session = await createCheckout({
        appUrl: appOrigin(),
        auth: getAuth(),
        db,
        expectedPriceId: STRIPE_PRICE_ID.value(),
        req,
        stripe: stripeClient(),
      })
      // Hosted Checkout always has a URL; without one the browser has nowhere to go.
      if (!session.url) throw new Error('Checkout session has no URL')
      return { body: { url: session.url } }
    },
  }),
)

export const createBillingPortalSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 30, maxInstances: 10 },
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

export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], timeoutSeconds: 60, maxInstances: 10 },
  async (req, res) => {
    setApiHeaders(res)
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      res.status(405).json({ error: 'Method Not Allowed' })
      return
    }

    const stripe = stripeClient()
    const signature = req.headers['stripe-signature']
    let event: Stripe.Event
    try {
      if (typeof signature !== 'string') throw new Error('Missing Stripe signature')
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value())
    } catch (error) {
      logger.warn('stripeWebhook signature rejected', { error: loggableError(error) })
      res.status(400).json({ error: 'Invalid signature' })
      return
    }

    try {
      const result = await processStripeEvent({
        db,
        event,
        expectedPriceId: STRIPE_PRICE_ID.value(),
        serverTimestamp,
        stripe,
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

export const backfillStripeBillingResources = onSchedule(
  { schedule: 'every 60 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const stripe = stripeClient()
    let result: BackfillResult | undefined
    for (let page = 0; page < BACKFILL_PAGES_PER_RUN; page += 1) {
      result = await backfillBillingResourcePage({ db, serverTimestamp, stripe })
      if (result.completed) break
    }
    logger.info('Stripe billing resource backfill run completed', { result })
  },
)

export const cleanupFailedCheckouts = onSchedule(
  { schedule: 'every 5 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const results = await processPendingCheckoutCleanups({ db, stripe: stripeClient() })
    const failed = results.filter(result => !result.completed).length
    const fields = { processed: results.length, failed, results }
    if (failed > 0) logger.warn('Failed checkout cleanup tasks processed with failures', fields)
    else logger.info('Failed checkout cleanup tasks processed', fields)
  },
)
