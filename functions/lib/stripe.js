const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

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

async function commitEvent(db, event, userRef, userData, serverTimestamp) {
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  if ((await eventRef.get()).exists) return { duplicate: true }

  const batch = db.batch()
  if (userRef && userData) batch.set(userRef, userData, { merge: true })
  batch.create(eventRef, {
    type: event.type,
    processedAt: serverTimestamp(),
  })

  try {
    await batch.commit()
    return { duplicate: false }
  } catch (error) {
    // Two webhook deliveries can race. A precondition failure means the other
    // delivery created the idempotency marker and completed the same write.
    if (error?.code === 6 || error?.code === 'already-exists') return { duplicate: true }
    throw error
  }
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
    const userSnapshot = await userRef.get()
    if (!userSnapshot.exists) throw new Error('Checkout account does not exist')

    return commitEvent(db, event, userRef, {
      tier: 'paid',
      proSince: userSnapshot.data().proSince || serverTimestamp(),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      subscriptionUpdatedAt: serverTimestamp(),
    }, serverTimestamp)
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    if (!subscriptionHasPrice(subscription, expectedPriceId)) {
      throw new Error('Subscription does not contain the configured price')
    }
    const user = await findUserBySubscription(db, subscription)
    if (!user) throw new Error('Subscription account does not exist')

    const active = event.type !== 'customer.subscription.deleted'
      && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    const update = {
      tier: active ? 'paid' : 'free',
      stripeCustomerId: stringId(subscription.customer),
      stripeSubscriptionId: stringId(subscription.id),
      subscriptionStatus: event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status,
      subscriptionUpdatedAt: serverTimestamp(),
    }
    if (!active) update.proSince = null
    return commitEvent(db, event, user.ref, update, serverTimestamp)
  }

  return { ignored: true }
}

async function createCheckout({ appUrl, auth, expectedPriceId, req, stripe }) {
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

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: expectedPriceId, quantity: 1 }],
    client_reference_id: identity.uid,
    customer_email: identity.email,
    metadata: { firebaseUid: identity.uid },
    subscription_data: { metadata: { firebaseUid: identity.uid } },
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=canceled`,
    allow_promotion_codes: true,
  })
}

module.exports = {
  createCheckout,
  processStripeEvent,
  subscriptionHasPrice,
  validUid,
  validateCheckoutSession,
}
