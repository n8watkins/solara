const { afterEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { authenticate, deleteAccount, safeAccountData } = require('../lib/account')
const { handleCors } = require('../lib/http')
const {
  cachedForecast,
  clearForecastCache,
  createCalendarFeedHandler,
  validCoordinates,
  validFeedToken,
} = require('../lib/calendar-feed')
const {
  createBillingPortal,
  createCheckout,
  processStripeEvent,
  subscriptionHasPrice,
  validUid,
  validateCheckoutSession,
} = require('../lib/stripe')

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    set(name, value) { this.headers[name] = value; return this },
    status(code) { this.statusCode = code; return this },
    send(body) { this.body = body; return this },
  }
}

function queryWith(doc) {
  return {
    where() { return this },
    limit() { return this },
    async get() { return { empty: !doc, docs: doc ? [doc] : [] } },
  }
}

function fakeDb(initialUser) {
  const events = new Set()
  const userData = { ...initialUser }
  const userRef = {
    id: 'alice',
    kind: 'user',
    async get() { return { exists: initialUser !== null, data: () => ({ ...userData }) } },
  }
  const database = {
    userData,
    collection(name) {
      if (name === 'users') {
        const doc = initialUser === null ? null : { ref: userRef, data: () => ({ ...userData }) }
        const query = queryWith(doc)
        query.doc = () => userRef
        return query
      }
      if (name === 'stripeWebhookEvents') {
        return {
          doc(id) {
            return { id, kind: 'event', async get() { return { exists: events.has(id) } } }
          },
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
    async runTransaction(callback) {
      const operations = []
      const result = await callback({
        async get(ref) { return ref.get() },
        set(ref, data) { operations.push(() => Object.assign(userData, data)); return this },
        create(ref) { operations.push(() => events.add(ref.id)); return this },
      })
      operations.forEach(operation => operation())
      return result
    },
  }
  return database
}

afterEach(clearForecastCache)

describe('account data security', () => {
  test('requires a valid Firebase bearer token', async () => {
    await assert.rejects(authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, ''), /required/)
    await assert.rejects(
      authenticate({ verifyIdToken: async () => { throw new Error('expired') } }, 'Bearer expired'),
      error => error.status === 401,
    )
    assert.equal(
      (await authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, 'Bearer valid')).uid,
      'alice',
    )
  })

  test('requires authentication within five minutes for destructive actions', async () => {
    const auth = { verifyIdToken: async () => ({ uid: 'alice', auth_time: 1000 }) }
    await assert.doesNotReject(authenticate(auth, 'Bearer valid', {
      maxAgeSeconds: 300,
      nowSeconds: 1300,
    }))
    await assert.rejects(
      authenticate(auth, 'Bearer valid', { maxAgeSeconds: 300, nowSeconds: 1301 }),
      error => error.status === 401 && error.code === 'reauth-required',
    )
    await assert.rejects(
      authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, 'Bearer valid', {
        maxAgeSeconds: 300,
        nowSeconds: 1300,
      }),
      error => error.code === 'reauth-required',
    )
  })

  test('redacts capability and provider identifiers from exports', () => {
    assert.deepEqual(safeAccountData({
      location: { city: 'Seattle' },
      calendarFeedToken: 'secret',
      fcmToken: 'secret',
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
    }), { location: { city: 'Seattle' } })
  })

  test('deletes notification ownership and throttle records with the account', async () => {
    const deleted = []
    const userRef = { kind: 'user', async get() { return { exists: true, data: () => ({}) } } }
    const db = {
      collection(name) {
        if (name === 'users') return { doc: () => userRef }
        if (name === 'notificationTokenOwners') {
          return {
            where: () => ({
              async get() {
                return { docs: [{ ref: { delete: async () => deleted.push('owner') } }] }
              },
            }),
          }
        }
        if (name === 'notificationRegistrationLimits') {
          return { doc: () => ({ delete: async () => deleted.push('limit') }) }
        }
        throw new Error(`Unexpected collection ${name}`)
      },
      async recursiveDelete(ref) { assert.equal(ref, userRef); deleted.push('user') },
    }
    const auth = {
      verifyIdToken: async () => ({ uid: 'alice', auth_time: Math.floor(Date.now() / 1000) }),
      deleteUser: async uid => deleted.push(`auth:${uid}`),
    }
    await deleteAccount({
      auth,
      db,
      req: { headers: { authorization: 'Bearer valid' }, body: { confirmation: 'DELETE' } },
      stripe: { subscriptions: { cancel: async () => {} } },
    })
    assert.deepEqual(deleted, ['owner', 'limit', 'user', 'auth:alice'])
  })
})

describe('browser API CORS', () => {
  test('allows preflight only from the configured app origin', () => {
    const allowed = responseRecorder()
    assert.equal(handleCors(
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-headers': 'authorization,content-type,x-firebase-appcheck',
        },
      },
      allowed,
      'https://app.example.com',
      ['POST'],
    ), true)
    assert.equal(allowed.statusCode, 204)
    assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://app.example.com')
    assert.equal(
      allowed.headers['Access-Control-Allow-Headers'],
      'Authorization, Content-Type, X-Firebase-AppCheck',
    )
    assert.equal(allowed.headers['Access-Control-Allow-Methods'], 'POST')

    const denied = responseRecorder()
    assert.equal(handleCors(
      { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } },
      denied,
      'https://app.example.com',
      ['POST'],
    ), true)
    assert.equal(denied.statusCode, 403)
    assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined)
  })

  test('permits a normal request from the configured app origin', () => {
    const res = responseRecorder()
    assert.equal(handleCors(
      { method: 'POST', headers: { origin: 'https://app.example.com' } },
      res,
      'https://app.example.com',
      ['POST'],
    ), false)
    assert.equal(res.headers.Vary, 'Origin')
  })
})

describe('calendar feed security', () => {
  test('accepts only fixed-format URL-safe secrets and valid coordinates', () => {
    assert.equal(validFeedToken('A'.repeat(32)), true)
    assert.equal(validFeedToken('A'.repeat(31)), false)
    assert.equal(validFeedToken(`${'A'.repeat(31)}!`), false)
    assert.equal(validCoordinates({ lat: 90, lon: -180 }), true)
    assert.equal(validCoordinates({ lat: 91, lon: 0 }), false)
  })

  test('caches identical rounded-location forecast requests', async () => {
    let calls = 0
    const fetcher = async () => { calls += 1; return [{ dateStr: '2026-07-14' }] }
    await cachedForecast(fetcher, { lat: 47.611, lon: -122.331 }, 7, 1000)
    await cachedForecast(fetcher, { lat: 47.612, lon: -122.332 }, 7, 1001)
    assert.equal(calls, 1)
  })

  test('returns a private feed with defensive headers', async () => {
    const handler = createCalendarFeedHandler({
      buildICS: events => `calendar:${events.length}`,
      buildSunEvents: () => [{ id: 1 }],
      db: { collection: () => queryWith({ data: () => ({ location: { lat: 1, lon: 2 } }) }) },
      days: 7,
      fetchForecast: async () => [],
    })
    const res = responseRecorder()
    await handler({ method: 'GET', query: { token: 'A'.repeat(32) } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'calendar:1')
    assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0')
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive')
  })

  test('rejects unsupported methods before querying Firestore', async () => {
    const handler = createCalendarFeedHandler({
      buildICS: () => '',
      buildSunEvents: () => [],
      db: { collection: () => { throw new Error('must not query') } },
      days: 7,
      fetchForecast: async () => [],
    })
    const res = responseRecorder()
    await handler({ method: 'POST', query: {} }, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers.Allow, 'GET, HEAD')
  })
})

describe('Stripe fulfillment security', () => {
  const session = {
    id: 'cs_123',
    mode: 'subscription',
    payment_status: 'paid',
    client_reference_id: 'alice',
    metadata: { firebaseUid: 'alice' },
    customer: 'cus_123',
    subscription: 'sub_123',
  }
  const stripe = {
    checkout: {
      sessions: {
        listLineItems: async () => ({ data: [{ price: { id: 'price_pro' } }] }),
      },
    },
    subscriptions: {
      retrieve: async id => ({
        id,
        customer: 'cus_123',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      }),
    },
  }

  test('validates Firebase identifiers and configured Stripe products', async () => {
    assert.equal(validUid('firebase_User-1'), true)
    assert.equal(validUid('../users/admin'), false)
    await assert.doesNotReject(validateCheckoutSession(stripe, session, 'price_pro'))
    await assert.rejects(
      validateCheckoutSession(stripe, { ...session, metadata: { firebaseUid: 'mallory' } }, 'price_pro'),
      /not bound/,
    )
    await assert.rejects(validateCheckoutSession(stripe, session, 'price_other'), /configured price/)
  })

  test('recognizes only the configured subscription price', () => {
    const subscription = { items: { data: [{ price: { id: 'price_pro' } }] } }
    assert.equal(subscriptionHasPrice(subscription, 'price_pro'), true)
    assert.equal(subscriptionHasPrice(subscription, 'price_other'), false)
    assert.equal(subscriptionHasPrice(subscription, ''), false)
  })

  test('creates checkout from verified identity rather than request body identity', async () => {
    let params
    let requestOptions
    const checkout = await createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({ tier: 'free' }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { uid: 'mallory' } },
      stripe: { checkout: { sessions: { create: async (value, options) => {
        params = value
        requestOptions = options
        return { url: 'https://checkout.stripe.com/session' }
      } } } },
    })
    assert.equal(checkout.url, 'https://checkout.stripe.com/session')
    assert.equal(params.client_reference_id, 'alice')
    assert.deepEqual(params.metadata, { firebaseUid: 'alice' })
    assert.equal(params.line_items[0].price, 'price_pro')
    assert.equal(requestOptions.idempotencyKey, 'checkout:alice:new:none')
  })

  test('creates a billing portal only for the authenticated customer', async () => {
    let params
    const session = await createBillingPortal({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db: fakeDb({ stripeCustomerId: 'cus_123' }),
      req: { headers: { authorization: 'Bearer valid-token' } },
      stripe: { billingPortal: { sessions: { create: async value => { params = value; return { url: 'https://billing.stripe.com/session/test' } } } } },
    })
    assert.equal(session.url, 'https://billing.stripe.com/session/test')
    assert.deepEqual(params, { customer: 'cus_123', return_url: 'https://example.com/account/' })
    await assert.rejects(createBillingPortal({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db: fakeDb({ tier: 'free' }),
      req: { headers: { authorization: 'Bearer valid-token' } },
      stripe: { billingPortal: { sessions: { create: async () => ({}) } } },
    }), error => error.status === 404)
  })

  test('prevents duplicate subscriptions and reuses known Stripe customers', async () => {
    const options = {
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' } },
      stripe: { checkout: { sessions: { create: async params => params } } },
    }
    await assert.rejects(
      createCheckout({
        ...options,
        db: fakeDb({ stripeSubscriptionId: 'sub_active', subscriptionStatus: 'active' }),
      }),
      error => error.status === 409,
    )

    const checkout = await createCheckout({
      ...options,
      db: fakeDb({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_canceled',
        subscriptionStatus: 'canceled',
      }),
    })
    assert.equal(checkout.customer, 'cus_123')
    assert.equal(checkout.customer_email, undefined)
  })

  test('grants paid tier once for a valid completed checkout event', async () => {
    const db = fakeDb({ tier: 'free' })
    const event = { id: 'evt_1', created: 100, type: 'checkout.session.completed', data: { object: session } }
    const options = {
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    }

    const first = await processStripeEvent(options)
    const second = await processStripeEvent(options)
    assert.equal(first.duplicate, false)
    assert.equal(second.duplicate, true)
    assert.equal(db.userData.tier, 'paid')
    assert.equal(db.userData.stripeSubscriptionId, 'sub_123')
    assert.equal(db.userData.subscriptionStatus, 'active')
  })

  test('revokes access when the configured subscription ends', async () => {
    const db = fakeDb({
      tier: 'paid',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })
    const event = {
      id: 'evt_2',
      created: 200,
      type: 'customer.subscription.deleted',
      data: { object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    }
    await processStripeEvent({
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'canceled')
    assert.equal(db.userData.proSince, null)
  })

  test('revokes access when an owned subscription removes the configured price', async () => {
    const db = fakeDb({
      tier: 'paid',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    })
    const wrongPriceStripe = {
      subscriptions: {
        retrieve: async () => ({
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_other' } }] },
        }),
      },
    }
    await processStripeEvent({
      db,
      event: {
        id: 'evt_wrong_price',
        created: 201,
        type: 'customer.subscription.updated',
        data: { object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_other' } }] },
        } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: wrongPriceStripe,
    })

    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'active')
    assert.equal(db.userData.proSince, null)
  })

  test('does not restore access from an older or lower-priority event', async () => {
    const db = fakeDb({
      tier: 'free',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'canceled',
      stripeEventCreated: 200,
      stripeEventPriority: 2,
    })
    const event = {
      id: 'evt_old',
      created: 199,
      type: 'customer.subscription.updated',
      data: { object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    }
    const result = await processStripeEvent({
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(result.applied, false)
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'canceled')
  })

  test('acknowledges deletion events after their account is gone', async () => {
    const db = fakeDb(null)
    const result = await processStripeEvent({
      db,
      event: {
        id: 'evt_deleted_account',
        created: 300,
        type: 'customer.subscription.deleted',
        data: { object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
          items: { data: [{ price: { id: 'price_pro' } }] },
        } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(result.duplicate, false)
  })
})
