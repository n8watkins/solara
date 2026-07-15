const SENSITIVE_EXPORT_FIELDS = new Set([
  'calendarFeedToken',
  'fcmToken',
  'stripeCustomerId',
  'stripeSubscriptionId',
])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])

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
    startingAfter = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !startingAfter) throw new Error('Stripe subscription pagination was incomplete')
  } while (startingAfter)
  return subscriptions
}

async function closeCheckoutSession(stripe, sessionId) {
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.status === 'open') {
      try {
        session = await stripe.checkout.sessions.expire(sessionId)
      } catch (error) {
        session = await stripe.checkout.sessions.retrieve(sessionId)
        if (session.status === 'open') throw error
      }
    }
  } catch (error) {
    if (error?.code !== 'resource_missing') throw error
  }
  return session
}

async function findAccountCheckoutSessions(stripe, customerId) {
  if (typeof customerId !== 'string' || !customerId) return []
  const sessions = []
  let startingAfter
  do {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    sessions.push(...page.data)
    startingAfter = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !startingAfter) throw new Error('Stripe checkout pagination was incomplete')
  } while (startingAfter)

  return Promise.all(sessions.map(session => (
    session.status === 'open' ? closeCheckoutSession(stripe, session.id) : session
  )))
}

async function authenticate(auth, authorization, options = {}) {
  const match = (authorization || '').match(/^Bearer (.+)$/)
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
  if (options.maxAgeSeconds) {
    const authenticatedAt = identity.auth_time
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (!Number.isFinite(authenticatedAt) || nowSeconds - authenticatedAt > options.maxAgeSeconds) {
      const error = new Error('Recent authentication required')
      error.status = 401
      error.code = 'reauth-required'
      throw error
    }
  }
  return identity
}

function safeAccountData(data) {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => !SENSITIVE_EXPORT_FIELDS.has(key)),
  )
}

function safeDeviceData(snapshot) {
  return snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      enabled: data.enabled === true,
      platform: data.platform || 'unknown',
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      lastDeliveredAt: data.lastDeliveredAt || null,
      lastError: data.lastError || null,
    }
  })
}

async function exportAccountData({ auth, db, req }) {
  const identity = await authenticate(auth, req.headers.authorization)
  const userRef = db.collection('users').doc(identity.uid)
  const [userSnapshot, devicesSnapshot] = await Promise.all([
    userRef.get(),
    userRef.collection('notificationDevices').get(),
  ])
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data()) : null,
    notificationDevices: safeDeviceData(devicesSnapshot),
  }
}

async function deleteAccount({ auth, db, req, stripe }) {
  const identity = await authenticate(auth, req.headers.authorization, { maxAgeSeconds: 300 })
  if (req.body?.confirmation !== 'DELETE') {
    const error = new Error('Deletion confirmation required')
    error.status = 400
    throw error
  }

  const userRef = db.collection('users').doc(identity.uid)
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  const revokedBefore = Math.floor(Date.now() / 1000)
  const billing = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef)
    transaction.set(tombstoneRef, {
      revokedBefore,
      createdAt: new Date(),
    })
    if (!snapshot.exists) return {}
    transaction.set(userRef, { accountDeletionStartedAt: new Date() }, { merge: true })
    return {
      checkoutSessionId: snapshot.data().stripeCheckoutSessionId,
      customerId: snapshot.data().stripeCustomerId,
      subscriptionId: snapshot.data().stripeSubscriptionId,
    }
  })
  const subscriptionIds = new Set()
  const accountSessions = []
  if (typeof billing.checkoutSessionId === 'string' && billing.checkoutSessionId) {
    const session = await closeCheckoutSession(stripe, billing.checkoutSessionId)
    if (session) accountSessions.push(session)
    if (!billing.customerId) {
      billing.customerId = typeof session?.customer === 'string'
        ? session.customer
        : session?.customer?.id
    }
  }
  const customerSessions = await findAccountCheckoutSessions(stripe, billing.customerId)
  for (const session of customerSessions) {
    if (!accountSessions.some(existing => existing?.id === session?.id)) accountSessions.push(session)
  }
  for (const session of accountSessions) {
    const sessionSubscriptionId = typeof session?.subscription === 'string'
      ? session.subscription
      : session?.subscription?.id
    if (sessionSubscriptionId) subscriptionIds.add(sessionSubscriptionId)
    if (!billing.customerId) {
      billing.customerId = typeof session?.customer === 'string' ? session.customer : session?.customer?.id
    }
  }
  if (typeof billing.subscriptionId === 'string' && billing.subscriptionId) {
    subscriptionIds.add(billing.subscriptionId)
  }
  if (typeof billing.customerId === 'string' && billing.customerId) {
    const subscriptions = await listCustomerSubscriptions(stripe, billing.customerId)
    for (const subscription of subscriptions) {
      if (typeof subscription.id === 'string'
        && !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
        subscriptionIds.add(subscription.id)
      }
    }
  }
  for (const subscriptionId of subscriptionIds) {
    try {
      await stripe.subscriptions.cancel(subscriptionId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
  }

  const tokenOwners = await db.collection('notificationTokenOwners')
    .where('uid', '==', identity.uid).get()
  await Promise.all(tokenOwners.docs.map(owner => owner.ref.delete()))
  await db.collection('notificationRegistrationLimits').doc(identity.uid).delete()
  await db.recursiveDelete(userRef)
  await auth.deleteUser(identity.uid)
}

module.exports = { authenticate, deleteAccount, exportAccountData, safeAccountData }
