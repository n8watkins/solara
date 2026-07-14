const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const EVENT_PRIORITY = {
  'checkout.session.completed': 0,
  'customer.subscription.updated': 1,
  'customer.subscription.deleted': 2,
}

function validUid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function stringId(value) {
  if (typeof value === 'string') return value
  return value && typeof value.id === 'string' ? value.id : null
}

function subscriptionHasPrice(subscription, expectedPriceId) {
  if (!expectedPriceId) return false
  const items = subscription?.items?.data
  return Array.isArray(items) && items.some(item => stringId(item?.price) === expectedPriceId)
}

async function validateCheckoutSession(stripe, session, expectedPriceId) {
  const uid = session?.client_reference_id
  if (!validUid(uid) || session?.metadata?.firebaseUid !== uid) {
    throw new Error('Checkout session is not bound to an authenticated account')
  }
  if (session.mode !== 'subscription') throw new Error('Checkout session has an unexpected mode')
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
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
  return { uid, customerId, subscriptionId }
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
    if (eventSnapshot.exists) return { duplicate: true }

    let applied = false
    if (userRef && buildUserData) {
      const userSnapshot = await transaction.get(userRef)
      if (userSnapshot.exists && eventIsNewer(event, userSnapshot.data())) {
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
    return { duplicate: false, applied }
  })
}

async function processStripeEvent({ db, event, expectedPriceId, serverTimestamp, stripe }) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const { uid, customerId, subscriptionId } = await validateCheckoutSession(
      stripe,
      session,
      expectedPriceId,
    )
    const userRef = db.collection('users').doc(uid)
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const active = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
      && subscriptionHasPrice(subscription, expectedPriceId)

    return commitEvent(db, event, userRef, userData => {
      if (userData.stripeSubscriptionId
        && userData.stripeSubscriptionId !== subscriptionId
        && !TERMINAL_SUBSCRIPTION_STATUSES.has(userData.subscriptionStatus)) return null
      return {
        tier: active ? 'paid' : 'free',
        proSince: active ? userData.proSince || serverTimestamp() : null,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: subscription.status,
        subscriptionUpdatedAt: serverTimestamp(),
      }
    }, serverTimestamp)
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    if (!subscriptionHasPrice(subscription, expectedPriceId)) {
      throw new Error('Subscription does not contain the configured price')
    }
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
      return update
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

  const userSnapshot = await db.collection('users').doc(identity.uid).get()
  if (!userSnapshot.exists) {
    const error = new Error('Account does not exist')
    error.status = 404
    throw error
  }
  const userData = userSnapshot.data()
  if (userData.stripeSubscriptionId
    && !TERMINAL_SUBSCRIPTION_STATUSES.has(userData.subscriptionStatus)) {
    const error = new Error('Account already has a subscription')
    error.status = 409
    throw error
  }

  const customer = typeof userData.stripeCustomerId === 'string' && userData.stripeCustomerId
    ? { customer: userData.stripeCustomerId }
    : { customer_email: identity.email }
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: expectedPriceId, quantity: 1 }],
    client_reference_id: identity.uid,
    ...customer,
    metadata: { firebaseUid: identity.uid },
    subscription_data: { metadata: { firebaseUid: identity.uid } },
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=canceled`,
    allow_promotion_codes: true,
  }, {
    idempotencyKey: [
      'checkout',
      identity.uid,
      userData.stripeSubscriptionId || 'new',
      userData.subscriptionStatus || 'none',
    ].join(':'),
  })
}

module.exports = {
  createCheckout,
  processStripeEvent,
  subscriptionHasPrice,
  validUid,
  validateCheckoutSession,
}
