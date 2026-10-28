// An in-memory Stripe client for the Functions' emulator tests: the methods the billing
// and deletion code call, answering with Stripe-shaped objects and Stripe's
// `resource_missing` errors. `forget()` makes Stripe lose an object, and `failNext()`
// makes a method throw, to test that deletion never stalls. A checkout can be paid with
// a card (`complete(id, { card })`), whose fingerprint identifies it across customers.
const DAY = 24 * 60 * 60

function missing(id) {
  return Object.assign(new Error(`No such object: '${id}'`), { code: 'resource_missing' })
}

function list(data) {
  return { object: 'list', data, has_more: false }
}

class FakeStripe {
  constructor() {
    this.sessions = new Map()
    this.subscriptionsById = new Map()
    this.customersById = new Map()
    this.invoicesById = new Map()
    this.paymentMethodsById = new Map()
    this.subscriptionUpdates = []
    this.refundsMade = []
    this.deletedCustomers = []
    this.failures = new Map()
    this.counter = 0
    const nextId = prefix => `${prefix}_test_${++this.counter}`
    const failing = name => {
      const remaining = this.failures.get(name)
      if (remaining) {
        this.failures.set(name, remaining - 1)
        throw new Error(`Stripe ${name} failed`)
      }
    }
    this.nextId = nextId

    this.checkout = {
      sessions: {
        create: async params => {
          const session = {
            id: nextId('cs'),
            object: 'checkout.session',
            mode: params.mode,
            status: 'open',
            payment_status: 'unpaid',
            client_reference_id: params.client_reference_id,
            customer: params.customer ?? null,
            metadata: params.metadata ?? {},
            subscription: null,
            url: 'https://checkout.stripe.com/c/pay/test',
            expires_at: Math.floor(Date.now() / 1000) + DAY,
            _params: params,
          }
          this.sessions.set(session.id, session)
          return session
        },
        retrieve: async id => {
          const session = this.sessions.get(id)
          if (!session) throw missing(id)
          return session
        },
        expire: async id => {
          const session = this.sessions.get(id)
          if (!session) throw missing(id)
          session.status = 'expired'
          return session
        },
        listLineItems: async id => {
          const session = this.sessions.get(id)
          if (!session) throw missing(id)
          return list([{ price: { id: session._params.line_items[0].price } }])
        },
        list: async ({ customer }) => {
          if (customer && !this.customersById.has(customer)) throw missing(customer)
          return list([...this.sessions.values()].filter(s => !customer || s.customer === customer))
        },
      },
    }
    this.subscriptions = {
      retrieve: async id => {
        const subscription = this.subscriptionsById.get(id)
        if (!subscription) throw missing(id)
        return subscription
      },
      list: async ({ customer }) => {
        if (customer && !this.customersById.has(customer)) throw missing(customer)
        return list([...this.subscriptionsById.values()].filter(s => s.customer === customer))
      },
      update: async (id, params, options) => {
        const subscription = this.subscriptionsById.get(id)
        if (!subscription) throw missing(id)
        this.subscriptionUpdates.push({ id, params, options })
        if (params.trial_end === 'now' && subscription.status === 'trialing') {
          subscription.trial_end = Math.floor(Date.now() / 1000)
          subscription.status = 'active'
        }
        return subscription
      },
      cancel: async id => {
        failing('subscriptions.cancel')
        const subscription = this.subscriptionsById.get(id)
        if (!subscription) throw missing(id)
        subscription.status = 'canceled'
        return subscription
      },
    }
    this.customers = {
      del: async id => {
        if (!this.customersById.has(id)) throw missing(id)
        this.customersById.delete(id)
        this.deletedCustomers.push(id)
        for (const subscription of this.subscriptionsById.values()) {
          if (subscription.customer === id) subscription.status = 'canceled'
        }
        return { id, deleted: true }
      },
    }
    this.paymentMethods = {
      retrieve: async id => {
        const paymentMethod = this.paymentMethodsById.get(id)
        if (!paymentMethod) throw missing(id)
        return paymentMethod
      },
    }
    this.invoices = {
      list: async ({ subscription }) => {
        return list([...this.invoicesById.values()].filter(i => i._subscription === subscription))
      },
    }
    this.invoicePayments = {
      list: async ({ invoice }) => {
        const found = this.invoicesById.get(invoice)
        return list(
          found
            ? [{ payment: { type: 'payment_intent', payment_intent: found._paymentIntent } }]
            : [],
        )
      },
    }
    this.refunds = {
      create: async (params, options) => {
        this.refundsMade.push({ params, options })
        return { id: nextId('re') }
      },
    }
  }

  /** Completes a checkout the way a customer paying would; returns the event to deliver. */
  complete(
    sessionId,
    { trialDays = 0, status, created = Math.floor(Date.now() / 1000), card } = {},
  ) {
    const session = this.sessions.get(sessionId)
    if (!session.customer) {
      session.customer = this.nextId('cus')
      this.customersById.set(session.customer, { id: session.customer })
    }
    const price = session._params.line_items[0].price
    let paymentMethod = null
    if (card) {
      paymentMethod = {
        id: this.nextId('pm'),
        object: 'payment_method',
        card: { fingerprint: card },
      }
      this.paymentMethodsById.set(paymentMethod.id, paymentMethod)
    }
    const subscription = {
      id: this.nextId('sub'),
      object: 'subscription',
      customer: session.customer,
      status: status ?? (trialDays ? 'trialing' : 'active'),
      metadata: { ...session._params.subscription_data?.metadata },
      cancel_at_period_end: false,
      default_payment_method: paymentMethod?.id ?? null,
      trial_start: trialDays ? created : null,
      trial_end: trialDays ? created + trialDays * DAY : null,
      items: list([{ price: { id: price }, current_period_end: created + 30 * DAY }]),
    }
    this.subscriptionsById.set(subscription.id, subscription)
    if (!trialDays) {
      const invoice = {
        id: this.nextId('in'),
        amount_paid: 299,
        _subscription: subscription.id,
        _paymentIntent: this.nextId('pi'),
      }
      this.invoicesById.set(invoice.id, invoice)
    }
    Object.assign(session, {
      status: 'complete',
      subscription: subscription.id,
      payment_status: trialDays ? 'no_payment_required' : 'paid',
    })
    return {
      id: this.nextId('evt'),
      created,
      type: 'checkout.session.completed',
      data: { object: session },
    }
  }

  /** A customer.subscription.updated event for the subscription's current state. */
  updated(subscriptionId, changes, created = Math.floor(Date.now() / 1000)) {
    const subscription = this.subscriptionsById.get(subscriptionId)
    Object.assign(subscription, changes)
    return {
      id: this.nextId('evt'),
      created,
      type: 'customer.subscription.updated',
      data: { object: subscription },
    }
  }

  /** Stripe loses every customer and subscription (for example, deleted by hand). */
  forget() {
    this.customersById.clear()
    this.subscriptionsById.clear()
    this.sessions.clear()
  }

  /** The next `count` calls to `method` (for example 'subscriptions.cancel') throw. */
  failNext(method, count = 1) {
    this.failures.set(method, count)
  }
}

module.exports = { FakeStripe }
