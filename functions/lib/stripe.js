const { authenticate } = require('./account')
const { createHash } = require('node:crypto')

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const CHECKOUT_RESERVATION_MS = 24 * 60 * 60 * 1000
const EVENT_PRIORITY = {
  'checkout.session.completed': 0,
  'checkout.session.async_payment_failed': 1,
  'checkout.session.async_payment_succeeded': 2,
  'customer.subscription.updated': 3,
  'customer.subscription.deleted': 4,
}

function validUid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function validAttemptId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value)
}

function stringId(value) {
  if (typeof value === 'string') return value
  return value && typeof value.id === 'string' ? value.id : null
}

function dateMillis(value) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return NaN
}

async function listCustomerSubscriptions(stripe, customerId) {
  const subscriptions = []
  let startingAfter
  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    subscriptions.push(...page.data)
    startingAfter = page.has_more ? stringId(page.data.at(-1)) : null
    if (page.has_more && !startingAfter) throw new Error('Stripe subscription pagination was incomplete')
  } while (startingAfter)
  return subscriptions
}

function subscriptionHasPrice(subscription, expectedPriceId) {
  if (!expectedPriceId) return false
  const items = subscription?.items?.data
  return Array.isArray(items) && items.some(item => stringId(item?.price) === expectedPriceId)
}

async function validateCheckoutSession(stripe, session, expectedPriceId, { requirePaid = true } = {}) {
  const uid = session?.client_reference_id
  const metadataUid = session?.metadata?.firebaseUid
  if (!validUid(uid) || (metadataUid !== undefined && metadataUid !== uid)) {
    throw new Error('Checkout session is not bound to an authenticated account')
  }
  if (session.mode !== 'subscription') throw new Error('Checkout session has an unexpected mode')
  const paid = ['paid', 'no_payment_required'].includes(session.payment_status)
  if (requirePaid && !paid) {
    throw new Error('Checkout session is not paid')
  }
  if (!expectedPriceId) throw new Error('STRIPE_PRICE_ID is not configured')

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 })
  if (!lineItems.data.some(item => stringId(item.price) === expectedPriceId)) {
    throw new Error('Checkout session does not contain the configured price')
  }

  const customerId = stringId(session.customer)
  const subscriptionId = stringId(session.subscription)
  if (!customerId || !subscriptionId) throw new Error('Checkout session is missing subscription data')
  return { uid, customerId, subscriptionId, paid }
}

async function findUserBySubscription(db, subscription) {
  const subscriptionId = stringId(subscription?.id)
  const customerId = stringId(subscription?.customer)
  if (subscriptionId) {
    const bySubscription = await db.collection('users')
      .where('stripeSubscriptionId', '==', subscriptionId).limit(1).get()
    if (!bySubscription.empty) return bySubscription.docs[0]
  }
  if (customerId) {
    const byCustomer = await db.collection('users')
      .where('stripeCustomerId', '==', customerId).limit(1).get()
    if (!byCustomer.empty) return byCustomer.docs[0]
  }
  return null
}

function eventIsNewer(event, userData) {
  const previousCreated = userData?.stripeEventCreated
  if (!Number.isFinite(previousCreated)) return true
  if (event.created !== previousCreated) return event.created > previousCreated
  return (EVENT_PRIORITY[event.type] ?? -1) >= (userData.stripeEventPriority ?? -1)
}

async function commitEvent(db, event, userRef, buildUserData, serverTimestamp) {
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  return db.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (eventSnapshot.exists) {
      if (!userRef || !buildUserData) return { duplicate: true }
      const tombstoneRef = db.collection('accountDeletionTombstones').doc(userRef.id)
      const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      return {
        duplicate: true,
        accountDeleted: tombstoneSnapshot.exists
          || !userSnapshot.exists
          || !!userSnapshot.data().accountDeletionStartedAt,
      }
    }

    let applied = false
    let accountDeleted = false
    if (userRef && buildUserData) {
      const tombstoneRef = db.collection('accountDeletionTombstones').doc(userRef.id)
      const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      accountDeleted = tombstoneSnapshot.exists
        || !userSnapshot.exists
        || !!userSnapshot.data().accountDeletionStartedAt
      if (!accountDeleted && eventIsNewer(event, userSnapshot.data())) {
        const userData = buildUserData(userSnapshot.data())
        if (userData) {
          transaction.set(userRef, {
            ...userData,
            stripeEventCreated: event.created,
            stripeEventPriority: EVENT_PRIORITY[event.type],
          }, { merge: true })
          applied = true
        }
      }
    }
    transaction.create(eventRef, {
      type: event.type,
      created: event.created,
      processedAt: serverTimestamp(),
    })
    return { duplicate: false, applied, accountDeleted }
  })
}

async function processStripeEvent({ db, event, expectedPriceId, serverTimestamp, stripe }) {
  if (event.type === 'checkout.session.completed'
    || event.type === 'checkout.session.async_payment_succeeded'
    || event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object
    const requirePaid = event.type === 'checkout.session.async_payment_succeeded'
    const { uid, customerId, subscriptionId, paid } = await validateCheckoutSession(
      stripe,
      session,
      expectedPriceId,
      { requirePaid },
    )
    const userRef = db.collection('users').doc(uid)
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const active = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
      && subscriptionHasPrice(subscription, expectedPriceId)
    const checkoutStatus = event.type === 'checkout.session.async_payment_failed'
      ? 'failed'
      : paid && active ? 'succeeded' : 'pending'

    const result = await commitEvent(db, event, userRef, userData => {
      if (userData.stripeSubscriptionId
        && userData.stripeSubscriptionId !== subscriptionId
        && !TERMINAL_SUBSCRIPTION_STATUSES.has(userData.subscriptionStatus)) return null
      return {
        tier: checkoutStatus === 'succeeded' ? 'paid' : 'free',
        proSince: checkoutStatus === 'succeeded' ? userData.proSince || serverTimestamp() : null,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeCheckoutSessionId: session.id,
        stripeCheckoutStatus: checkoutStatus,
        stripeCheckoutUpdatedAt: serverTimestamp(),
        subscriptionStatus: subscription.status,
        subscriptionUpdatedAt: serverTimestamp(),
      }
    }, serverTimestamp)
    if (result.accountDeleted) {
      try {
        await stripe.subscriptions.cancel(subscriptionId)
      } catch (error) {
        if (error?.code !== 'resource_missing') throw error
      }
    }
    return result
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const user = await findUserBySubscription(db, subscription)
    if (!user) {
      if (event.type === 'customer.subscription.deleted') {
        return commitEvent(db, event, null, null, serverTimestamp)
      }
      throw new Error('Subscription account does not exist')
    }

    const currentSubscription = event.type === 'customer.subscription.updated'
      ? await stripe.subscriptions.retrieve(subscription.id)
      : subscription
    const active = event.type !== 'customer.subscription.deleted'
      && ACTIVE_SUBSCRIPTION_STATUSES.has(currentSubscription.status)
      && subscriptionHasPrice(currentSubscription, expectedPriceId)
    const checkoutStatus = active
      ? 'succeeded'
      : TERMINAL_SUBSCRIPTION_STATUSES.has(currentSubscription.status) || currentSubscription.status === 'unpaid'
        ? 'failed'
        : null
    const update = {
      tier: active ? 'paid' : 'free',
      stripeCustomerId: stringId(currentSubscription.customer),
      stripeSubscriptionId: stringId(currentSubscription.id),
      subscriptionStatus: event.type === 'customer.subscription.deleted' ? 'canceled' : currentSubscription.status,
      subscriptionUpdatedAt: serverTimestamp(),
    }
    if (!active) update.proSince = null
    return commitEvent(db, event, user.ref, userData => {
      const currentSubscriptionId = userData.stripeSubscriptionId
      if (currentSubscriptionId && currentSubscriptionId !== stringId(subscription.id)) return null
      return checkoutStatus ? { ...update, stripeCheckoutStatus: checkoutStatus } : update
    }, serverTimestamp)
  }

  return { ignored: true }
}

async function createCheckout({ appUrl, auth, db, expectedPriceId, req, stripe }) {
  if (!expectedPriceId) throw new Error('STRIPE_PRICE_ID is not configured')
  const authorization = req.headers.authorization || ''
  const match = authorization.match(/^Bearer (.+)$/)
  if (!match) {
    const error = new Error('Authentication required')
    error.status = 401
    throw error
  }
  let identity
  try {
    identity = await auth.verifyIdToken(match[1], true)
  } catch {
    const error = new Error('Authentication required')
    error.status = 401
    throw error
  }
  if (!validUid(identity.uid)) {
    const error = new Error('Invalid account')
    error.status = 401
    throw error
  }
  const attemptId = req.body?.attemptId
  if (!validAttemptId(attemptId)) {
    const error = new Error('Invalid checkout attempt')
    error.status = 400
    throw error
  }

  const userRef = db.collection('users').doc(identity.uid)
  const now = Date.now()
  const reserveCheckout = expiredSessionId => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists) {
      const error = new Error('Account does not exist')
      error.status = 404
      throw error
    }
    const current = snapshot.data()
    if (current.accountDeletionStartedAt) {
      const error = new Error('Account deletion is in progress')
      error.status = 409
      throw error
    }
    if (current.stripeSubscriptionId
      && !TERMINAL_SUBSCRIPTION_STATUSES.has(current.subscriptionStatus)) {
      const error = new Error('Account already has a subscription')
      error.status = 409
      throw error
    }
    const reservedBy = current.stripeCheckoutAttemptId
    const reservedUntil = dateMillis(current.stripeCheckoutReservedUntil)
    const sessionId = current.stripeCheckoutSessionId
    if (current.stripeCheckoutStatus === 'pending'
      && typeof sessionId === 'string'
      && sessionId
      && sessionId !== expiredSessionId) {
      return { reuseSessionId: sessionId }
    }
    if (reservedBy && reservedBy !== attemptId && reservedUntil > now
      && sessionId !== expiredSessionId) {
      const error = new Error('Checkout is already in progress')
      error.status = 409
      throw error
    }
    transaction.set(userRef, {
      stripeCheckoutAttemptId: attemptId,
      stripeCheckoutSessionId: null,
      stripeCheckoutReservedUntil: new Date(now + CHECKOUT_RESERVATION_MS),
      stripeCheckoutStatus: 'creating',
    }, { merge: true })
    return { userData: current }
  })

  let reservation = await reserveCheckout()
  while (reservation.reuseSessionId) {
    let existing
    try {
      existing = await stripe.checkout.sessions.retrieve(reservation.reuseSessionId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
    if (existing?.status === 'open' && existing.url) return existing
    if (existing?.status === 'complete') {
      const error = new Error('Checkout payment is being processed')
      error.status = 409
      throw error
    }
    reservation = await reserveCheckout(reservation.reuseSessionId)
  }
  const userData = reservation.userData

  const releaseReservation = async () => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists || snapshot.data().stripeCheckoutAttemptId !== attemptId) return
    transaction.set(userRef, {
      stripeCheckoutAttemptId: null,
      stripeCheckoutReservedUntil: null,
      stripeCheckoutStatus: 'failed',
    }, { merge: true })
  })

  const customer = typeof userData.stripeCustomerId === 'string' && userData.stripeCustomerId
    ? { customer: userData.stripeCustomerId }
    : { customer_email: identity.email }
  try {
    if (customer.customer) {
      const subscriptions = await listCustomerSubscriptions(stripe, customer.customer)
      if (subscriptions.some(subscription => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status))) {
        const error = new Error('Account already has a subscription')
        error.status = 409
        throw error
      }
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: expectedPriceId, quantity: 1 }],
      client_reference_id: identity.uid,
      ...customer,
      metadata: { firebaseUid: identity.uid },
      subscription_data: { metadata: { firebaseUid: identity.uid } },
      success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?checkout=canceled`,
      allow_promotion_codes: true,
    }, {
      idempotencyKey: `checkout:${createHash('sha256')
        .update(`${identity.uid}\0${expectedPriceId}\0${attemptId}`)
        .digest('hex')}`,
    })
    const persisted = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef)
      if (!snapshot.exists
        || snapshot.data().accountDeletionStartedAt
        || snapshot.data().stripeCheckoutAttemptId !== attemptId) return false
      transaction.set(userRef, {
        stripeCheckoutSessionId: session.id,
        stripeCheckoutStatus: 'pending',
        stripeCheckoutReservedUntil: Number.isFinite(session.expires_at)
          ? new Date(session.expires_at * 1000)
          : new Date(now + CHECKOUT_RESERVATION_MS),
      }, { merge: true })
      return true
    })
    if (!persisted) {
      const currentSession = await stripe.checkout.sessions.retrieve(session.id)
      if (currentSession.status === 'open') {
        await stripe.checkout.sessions.expire(session.id)
      } else {
        const subscriptionId = stringId(currentSession.subscription)
        if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId)
      }
      const error = new Error('Account deletion is in progress')
      error.status = 409
      throw error
    }
    return session
  } catch (error) {
    await releaseReservation()
    throw error
  }
}

async function createBillingPortal({ appUrl, auth, db, req, stripe }) {
  const identity = await authenticate(auth, req.headers.authorization)
  if (!validUid(identity.uid)) {
    const error = new Error('Invalid account')
    error.status = 401
    throw error
  }
  const userSnapshot = await db.collection('users').doc(identity.uid).get()
  const customerId = userSnapshot.exists ? userSnapshot.data().stripeCustomerId : null
  if (typeof customerId !== 'string' || !customerId) {
    const error = new Error('No billing account exists')
    error.status = 404
    throw error
  }
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/account/`,
  })
}

module.exports = {
  createBillingPortal,
  createCheckout,
  listCustomerSubscriptions,
  processStripeEvent,
  subscriptionHasPrice,
  validAttemptId,
  validUid,
  validateCheckoutSession,
}
