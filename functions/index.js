const { onRequest } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret, defineString } = require('firebase-functions/params')
const { getApps, initializeApp } = require('firebase-admin/app')
const { getAppCheck } = require('firebase-admin/app-check')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const Stripe = require('stripe')

const {
  authenticate,
  deleteAccount,
  exportAccountData,
  processPendingAccountDeletions,
} = require('./lib/account')
const { createCalendarFeedHandler } = require('./lib/calendar-feed')
const { revokeCalendarFeed, rotateCalendarFeed } = require('./lib/feed-tokens')
const { createApiHandler, setApiHeaders } = require('./lib/http')
const { buildICS } = require('./lib/ics')
const { buildSunEvents, fetchForecast } = require('./lib/sun')
const {
  registerNotificationDevice,
  removeNotificationDevice,
} = require('./lib/notification-devices')
const {
  backfillBillingResourcePage,
  createBillingPortal,
  createCheckout,
  processPendingCheckoutCleanups,
  processStripeEvent,
} = require('./lib/stripe')

if (getApps().length === 0) initializeApp()
const db = getFirestore()

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
const STRIPE_PRICE_ID = defineString('STRIPE_PRICE_ID', { default: '' })
const APP_URL = defineString('APP_URL', { default: 'https://uv-activity-planner.web.app' })

function stripeClient() {
  return new Stripe(STRIPE_SECRET_KEY.value())
}

const appOrigin = () => APP_URL.value().replace(/\/$/, '')
const serverTimestamp = () => FieldValue.serverTimestamp()

/**
 * Every browser-called endpoint shares one pipeline: exact-origin CORS, one method,
 * App Check, then the handler. `limited-use` consumes the App Check token so it cannot
 * be replayed; it is used for the two irreversible or money-moving actions.
 *
 * @template T
 * @param {Omit<Parameters<typeof createApiHandler<T>>[0], 'allowedOrigin' | 'appCheck'>} options
 */
function browserApi(options) {
  return createApiHandler({ ...options, allowedOrigin: appOrigin, appCheck: () => getAppCheck() })
}

exports.createCheckoutSession = onRequest(
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
      return { body: { url: session.url } }
    },
  }),
)

exports.createBillingPortalSession = onRequest(
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

exports.exportAccountData = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'exportAccountData',
    method: 'GET',
    appCheckMode: 'standard',
    fallbackMessage: 'Export unavailable',
    handler: async req => ({ body: await exportAccountData({ auth: getAuth(), db, req }) }),
  }),
)

exports.deleteAccount = onRequest(
  { secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 60, maxInstances: 5 },
  browserApi({
    name: 'deleteAccount',
    method: 'DELETE',
    appCheckMode: 'limited-use',
    fallbackMessage: 'Deletion unavailable',
    handler: async req => {
      const result = await deleteAccount({ auth: getAuth(), db, req, stripe: stripeClient() })
      return {
        status: result.completed ? 200 : 202,
        body: { deleted: result.completed, deletionPending: !result.completed },
      }
    },
  }),
)

exports.registerNotificationDevice = onRequest(
  { timeoutSeconds: 30, maxInstances: 20 },
  browserApi({
    name: 'registerNotificationDevice',
    method: 'POST',
    appCheckMode: 'standard',
    fallbackMessage: 'Registration unavailable',
    handler: async req => ({
      body: await registerNotificationDevice({ auth: getAuth(), db, req, serverTimestamp }),
    }),
  }),
)

exports.removeNotificationDevice = onRequest(
  { timeoutSeconds: 30, maxInstances: 20 },
  browserApi({
    name: 'removeNotificationDevice',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Removal unavailable',
    handler: async req => ({
      body: await removeNotificationDevice({ auth: getAuth(), db, req }),
    }),
  }),
)

exports.rotateCalendarFeed = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'rotateCalendarFeed',
    method: 'POST',
    appCheckMode: 'standard',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization)
      return { body: await rotateCalendarFeed({ db, uid: identity.uid }) }
    },
  }),
)

exports.revokeCalendarFeed = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'revokeCalendarFeed',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization)
      return { body: await revokeCalendarFeed({ db, uid: identity.uid }) }
    },
  }),
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
        serverTimestamp,
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

exports.backfillStripeBillingResources = onSchedule(
  { schedule: 'every 60 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const stripe = stripeClient()
    let result
    for (let page = 0; page < 20; page += 1) {
      result = await backfillBillingResourcePage({
        db,
        serverTimestamp,
        stripe,
      })
      if (result.completed) break
    }
    console.log('Stripe billing resource backfill run completed', result)
  },
)

exports.cleanupDeletedAccountBilling = onSchedule(
  { schedule: 'every 5 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const results = await processPendingAccountDeletions({
      auth: getAuth(),
      db,
      stripe: stripeClient(),
    })
    console.log('Deleted account billing cleanup pages processed', { results })
  },
)

exports.cleanupFailedCheckouts = onSchedule(
  { schedule: 'every 5 minutes', secrets: [STRIPE_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const results = await processPendingCheckoutCleanups({
      db,
      stripe: stripeClient(),
    })
    console.log('Failed checkout cleanup tasks processed', { results })
  },
)

exports.calendarFeed = onRequest(
  { cors: false, timeoutSeconds: 30, maxInstances: 20, concurrency: 20 },
  createCalendarFeedHandler({ buildICS, buildSunEvents, db, days: 7, fetchForecast }),
)
