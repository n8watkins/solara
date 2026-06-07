// Solara Cloud Functions (Blaze plan).
//
//   stripeWebhook  (P5) — on checkout.session.completed, flip users/{uid}.tier = 'paid'.
//   calendarFeed   (P7b) — serve a per-user live .ics the calendar app re-fetches.
//
// SCAFFOLD: written but not yet deployed or load-tested. Configure secrets, deploy,
// then exercise in Stripe test mode and with a real subscribe URL. See docs/DEPLOYMENT.md.

const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const Stripe = require('stripe')

const { fetchForecast, buildSunEvents } = require('./lib/sun')
const { buildICS } = require('./lib/ics')

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')

const FEED_DAYS = 7

/**
 * P5 — Stripe fulfilment. Verifies the webhook signature against the raw body,
 * then on a completed checkout grants Pro to the uid carried in client_reference_id
 * (set by lib/billing.ts). The tier write is idempotent, so Stripe retries are safe.
 */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value())
    let event
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody, // raw body is required for signature verification
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET.value(),
      )
    } catch (err) {
      console.error('Stripe signature verification failed:', err.message)
      res.status(400).send(`Webhook Error: ${err.message}`)
      return
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const uid = session.client_reference_id
        if (uid) {
          // Persist the Stripe customer id so a future customer.subscription.deleted
          // handler can map the cancellation back to this uid and downgrade.
          await db.collection('users').doc(uid).set(
            {
              tier: 'paid',
              proSince: admin.firestore.FieldValue.serverTimestamp(),
              stripeCustomerId: session.customer || null,
            },
            { merge: true },
          )
          console.log(`Granted Pro to ${uid} (session ${session.id})`)
        } else {
          console.warn(`checkout.session.completed without client_reference_id (session ${session.id})`)
        }
      }
      // TODO: handle customer.subscription.deleted to downgrade once a uid↔customer
      // mapping is persisted at checkout.
      res.status(200).json({ received: true })
    } catch (err) {
      console.error('stripeWebhook handler error:', err)
      res.status(500).send('Handler error')
    }
  },
)

/**
 * P7b — live calendar feed. The user subscribes their calendar to
 * `…/calendarFeed?token=<feedToken>`; we look the user up by token and regenerate
 * the .ics from the latest forecast + prefs, so it updates as the forecast changes.
 * The token is the only credential, so it must be unguessable and revocable.
 */
exports.calendarFeed = onRequest({ cors: true }, async (req, res) => {
  const token = req.query.token
  if (!token || typeof token !== 'string' || token.length < 16) {
    res.status(400).send('Missing or invalid token')
    return
  }

  let snap
  try {
    snap = await db.collection('users').where('calendarFeedToken', '==', token).limit(1).get()
  } catch (err) {
    console.error('calendarFeed lookup error:', err)
    res.status(500).send('Lookup failed')
    return
  }
  if (snap.empty) { res.status(404).send('Unknown feed'); return }

  const user = snap.docs[0].data()
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  // private: the URL carries a per-user secret token, so shared proxies must not cache it.
  res.set('Cache-Control', 'private, max-age=3600')

  if (!user.location || typeof user.location.lat !== 'number') {
    res.status(200).send(buildICS([]))
    return
  }

  try {
    const forecast = await fetchForecast(user.location.lat, user.location.lon, FEED_DAYS)
    res.status(200).send(buildICS(buildSunEvents(user, forecast)))
  } catch (err) {
    console.error('calendarFeed build error:', err)
    res.status(502).send('Could not build feed')
  }
})
