const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret, defineString } = require('firebase-functions/params')
const admin = require('firebase-admin')
const Stripe = require('stripe')

const { createCalendarFeedHandler } = require('./lib/calendar-feed')
const { buildICS } = require('./lib/ics')
const { buildSunEvents, fetchForecast } = require('./lib/sun')
const { createCheckout, processStripeEvent } = require('./lib/stripe')

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
const STRIPE_PRICE_ID = defineString('STRIPE_PRICE_ID', { default: '' })
const APP_URL = defineString('APP_URL', { default: 'https://uv-activity-planner.web.app' })

function stripeClient() {
  return new Stripe(STRIPE_SECRET_KEY.value())
}

function setApiHeaders(res) {
  res.set('Cache-Control', 'no-store')
  res.set('Content-Type', 'application/json; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
}

exports.createCheckoutSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 30, maxInstances: 10 },
  async (req, res) => {
    setApiHeaders(res)
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      res.status(405).json({ error: 'Method Not Allowed' })
      return
    }
    try {
      const session = await createCheckout({
        appUrl: APP_URL.value().replace(/\/$/, ''),
        auth: admin.auth(),
        expectedPriceId: STRIPE_PRICE_ID.value(),
        req,
        stripe: stripeClient(),
      })
      res.status(200).json({ url: session.url })
    } catch (error) {
      const status = error.status || 500
      console.error('createCheckoutSession failed', { name: error?.name, message: error?.message })
      res.status(status).json({ error: status === 401 ? 'Authentication required' : 'Checkout unavailable' })
    }
  },
)

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], timeoutSeconds: 60, maxInstances: 10 },
  async (req, res) => {
    setApiHeaders(res)
    if (req.method !== 'POST') {
      res.set('Allow', 'POST')
      res.status(405).json({ error: 'Method Not Allowed' })
      return
    }

    const stripe = stripeClient()
    let event
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET.value(),
      )
    } catch (error) {
      console.warn('Stripe signature verification failed', { message: error?.message })
      res.status(400).json({ error: 'Invalid signature' })
      return
    }

    try {
      const result = await processStripeEvent({
        db,
        event,
        expectedPriceId: STRIPE_PRICE_ID.value(),
        serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
        stripe,
      })
      res.status(200).json({ received: true, duplicate: result.duplicate === true })
    } catch (error) {
      console.error('stripeWebhook failed', {
        eventId: event.id,
        eventType: event.type,
        name: error?.name,
        message: error?.message,
      })
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  },
)

exports.calendarFeed = onRequest(
  { cors: false, timeoutSeconds: 30, maxInstances: 20, concurrency: 20 },
  createCalendarFeedHandler({ buildICS, buildSunEvents, db, days: 7, fetchForecast }),
)
