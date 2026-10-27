// A local stand-in for the Stripe API, for the signed-in e2e suite.
//
// The suite never reaches Stripe. run.mjs starts this server and points the Functions
// emulator's Stripe client at it (STRIPE_API_BASE, honored only inside the emulator; see
// functions/src/billing/config.ts). It keeps checkout sessions, customers and
// subscriptions in memory, answers the calls the Functions make with Stripe-shaped
// objects, and, like Stripe, delivers signed webhook events to the stripeWebhook
// Function when a test completes a checkout or changes a subscription.
//
// Test-only routes under /__test/ stand in for what a customer does on Stripe's pages:
//   POST /__test/complete-checkout { sessionId }   pays (or starts the trial) and sends
//                                                 checkout.session.completed
//   POST /__test/cancel-at-period-end { subscriptionId }   as the customer portal would,
//                                                 and sends customer.subscription.updated
//   GET  /__test/state                             everything stored, for assertions
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const API_VERSION = '2026-09-30.endive'
const DAY = 24 * 60 * 60

/** Parses Stripe's form encoding (`a[b][0][c]=v`) into nested objects and arrays. */
export function parseForm(body) {
  const result = {}
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const keys = rawKey.split(/\[|\]\[|\]/).filter(Boolean)
    let target = result
    keys.forEach((key, index) => {
      const last = index === keys.length - 1
      const nextIsIndex = !last && /^\d+$/.test(keys[index + 1])
      if (last) target[key] = value
      else target = target[key] ??= nextIsIndex ? [] : {}
    })
  }
  return result
}

/** A Stripe-Signature header for `payload`, as Stripe signs webhook deliveries. */
export function stripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function list(data) {
  return { object: 'list', data, has_more: false, url: '/v1/list' }
}

function missing(res, id) {
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: `No such object: '${id}'`,
      },
    }),
  )
}

/**
 * Starts the fake Stripe API on `port`. `webhookUrl` and `webhookSecret` say where and
 * how to deliver events. Resolves with the server and its in-memory state.
 */
export function startFakeStripe({ host = '127.0.0.1', port, webhookUrl, webhookSecret }) {
  const state = {
    sessions: new Map(),
    customers: new Map(),
    subscriptions: new Map(),
    refunds: [],
    deletedCustomers: [],
    events: [],
  }
  let counter = 0
  const nextId = prefix => `${prefix}_test_${String(++counter).padStart(6, '0')}`
  const now = () => Math.floor(Date.now() / 1000)

  async function deliver(type, object) {
    const event = {
      id: nextId('evt'),
      object: 'event',
      api_version: API_VERSION,
      created: now() + counter,
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object },
    }
    state.events.push(event)
    const payload = JSON.stringify(event)
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': stripeSignature(payload, webhookSecret),
      },
      body: payload,
    })
    return { eventId: event.id, status: response.status, body: await response.json() }
  }

  function subscriptionFor(session) {
    const trialDays = Number(session.subscription_data?.trial_period_days ?? 0)
    const start = now()
    const trialEnd = trialDays ? start + trialDays * DAY : null
    const yearly = session.metadata?.plan === 'yearly'
    const periodEnd = trialEnd ?? start + (yearly ? 365 : 30) * DAY
    return {
      id: nextId('sub'),
      object: 'subscription',
      customer: session.customer,
      status: trialDays ? 'trialing' : 'active',
      metadata: { ...session.subscription_data?.metadata },
      cancel_at_period_end: false,
      trial_start: trialDays ? start : null,
      trial_end: trialEnd,
      latest_invoice: null,
      items: list([
        {
          id: nextId('si'),
          object: 'subscription_item',
          price: { id: session._price, object: 'price' },
          current_period_start: start,
          current_period_end: periodEnd,
        },
      ]),
    }
  }

  async function handle(req, res, body) {
    const url = new URL(req.url, `http://${host}`)
    const parts = url.pathname.split('/').filter(Boolean)
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const form = req.headers['content-type']?.includes('json')
      ? JSON.parse(body || '{}')
      : parseForm(body)

    // --- Test controls --------------------------------------------------------------
    if (parts[0] === '__test') {
      if (req.method === 'GET' && parts[1] === 'state') {
        return json(200, {
          sessions: [...state.sessions.values()],
          customers: [...state.customers.values()],
          subscriptions: [...state.subscriptions.values()],
          refunds: state.refunds,
          deletedCustomers: state.deletedCustomers,
          events: state.events.map(({ id, type }) => ({ id, type })),
        })
      }
      if (req.method === 'POST' && parts[1] === 'complete-checkout') {
        const session = state.sessions.get(form.sessionId)
        if (!session || session.status !== 'open') return missing(res, form.sessionId)
        if (!session.customer) {
          const customer = { id: nextId('cus'), object: 'customer', email: session.customer_email }
          state.customers.set(customer.id, customer)
          session.customer = customer.id
        }
        const subscription = subscriptionFor(session)
        state.subscriptions.set(subscription.id, subscription)
        Object.assign(session, {
          status: 'complete',
          subscription: subscription.id,
          payment_status: subscription.status === 'trialing' ? 'no_payment_required' : 'paid',
        })
        return json(200, await deliver('checkout.session.completed', session))
      }
      if (req.method === 'POST' && parts[1] === 'cancel-at-period-end') {
        const subscription = state.subscriptions.get(form.subscriptionId)
        if (!subscription) return missing(res, form.subscriptionId)
        subscription.cancel_at_period_end = true
        return json(200, await deliver('customer.subscription.updated', subscription))
      }
      return json(404, { error: 'unknown test route' })
    }

    // --- Stripe API ------------------------------------------------------------------
    const [version, resource, id, action] = parts
    if (version !== 'v1') return json(404, { error: { message: 'Unknown API version' } })

    if (resource === 'checkout' && id === 'sessions') {
      const sessionId = action
      const sub = parts[4]
      if (req.method === 'POST' && !sessionId) {
        const session = {
          id: nextId('cs'),
          object: 'checkout.session',
          mode: form.mode,
          status: 'open',
          payment_status: 'unpaid',
          client_reference_id: form.client_reference_id ?? null,
          customer: form.customer ?? null,
          customer_email: form.customer_email ?? null,
          metadata: form.metadata ?? {},
          subscription: null,
          subscription_data: form.subscription_data ?? {},
          success_url: form.success_url,
          cancel_url: form.cancel_url,
          expires_at: now() + DAY,
          _price: form.line_items?.[0]?.price,
        }
        session.url = `https://checkout.stripe.com/c/pay/${session.id}`
        state.sessions.set(session.id, session)
        return json(200, session)
      }
      if (req.method === 'GET' && !sessionId) {
        const sessions = [...state.sessions.values()].filter(
          session =>
            !url.searchParams.get('customer') ||
            session.customer === url.searchParams.get('customer'),
        )
        return json(200, list(sessions))
      }
      const session = state.sessions.get(sessionId)
      if (!session) return missing(res, sessionId)
      if (req.method === 'GET' && sub === 'line_items') {
        return json(
          200,
          list([{ object: 'item', price: { id: session._price, object: 'price' }, quantity: 1 }]),
        )
      }
      if (req.method === 'POST' && sub === 'expire') {
        if (session.status !== 'open') {
          return json(400, {
            error: { type: 'invalid_request_error', message: 'Session is not open' },
          })
        }
        session.status = 'expired'
        return json(200, session)
      }
      if (req.method === 'GET') return json(200, session)
    }

    if (resource === 'subscriptions') {
      if (req.method === 'GET' && !id) {
        const customer = url.searchParams.get('customer')
        return json(
          200,
          list(
            [...state.subscriptions.values()].filter(sub => !customer || sub.customer === customer),
          ),
        )
      }
      const subscription = state.subscriptions.get(id)
      if (!subscription) return missing(res, id)
      if (req.method === 'GET') return json(200, subscription)
      if (req.method === 'DELETE') {
        subscription.status = 'canceled'
        return json(200, subscription)
      }
    }

    if (resource === 'customers') {
      const customer = state.customers.get(id)
      if (!customer) return missing(res, id)
      if (req.method === 'GET') return json(200, customer)
      if (req.method === 'DELETE') {
        state.customers.delete(id)
        state.deletedCustomers.push(id)
        return json(200, { id, object: 'customer', deleted: true })
      }
    }

    if (resource === 'billing_portal' && id === 'sessions' && req.method === 'POST') {
      if (!state.customers.has(form.customer)) return missing(res, form.customer)
      return json(200, {
        id: nextId('bps'),
        object: 'billing_portal.session',
        customer: form.customer,
        return_url: form.return_url,
        url: `https://billing.stripe.com/p/session/${nextId('test')}`,
      })
    }

    if (resource === 'invoices' && req.method === 'GET' && id) {
      return missing(res, id)
    }

    if (resource === 'refunds' && req.method === 'POST') {
      const refund = { id: nextId('re'), object: 'refund', status: 'succeeded', ...form }
      state.refunds.push(refund)
      return json(200, refund)
    }

    return json(404, {
      error: {
        type: 'invalid_request_error',
        message: `fake Stripe: no route for ${req.method} ${url.pathname}`,
      },
    })
  }

  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      handle(req, res, body).catch(error => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: String(error?.message ?? error) } }))
      })
    })
  })
  return new Promise(resolveStarted => {
    server.listen(port, host, () => resolveStarted({ server, state }))
  })
}
