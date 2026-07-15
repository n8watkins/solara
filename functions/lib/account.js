const {
  queueBillingCleanup,
  stripeSessionBelongsToUser,
} = require('./billing-resources')

const SENSITIVE_EXPORT_FIELDS = new Set([
  'calendarFeedToken',
  'fcmToken',
  'stripeCustomerId',
  'stripeSubscriptionId',
])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const BILLING_INDEX_PAGE_SIZE = 25
const BILLING_CLEANUP_PAGE_SIZE = 10

function stringId(value) {
  if (typeof value === 'string') return value
  return value && typeof value.id === 'string' ? value.id : null
}

function stripePageCursor(page) {
  const cursor = page.has_more ? stringId(page.data.at(-1)) : null
  if (page.has_more && !cursor) throw new Error('Stripe pagination was incomplete')
  return cursor
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

async function markCleanupResource(ref, data) {
  await ref.set({ ...data, updatedAt: new Date() }, { merge: true })
}

async function queueDiscoveredResources(db, tombstoneRef, resources) {
  await db.runTransaction(async transaction => {
    await queueBillingCleanup(transaction, tombstoneRef, resources, new Date())
  })
}

async function processCheckoutCleanup({ db, resource, stripe, tombstoneRef, uid }) {
  const data = resource.data()
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(data.stripeId)
  } catch (error) {
    if (error?.code === 'resource_missing') {
      await markCleanupResource(resource.ref, { status: 'completed' })
      return
    }
    throw error
  }
  if (data.verified !== true && !stripeSessionBelongsToUser(session, uid)) {
    await markCleanupResource(resource.ref, { status: 'completed', ownershipRejected: true })
    return
  }
  await queueDiscoveredResources(db, tombstoneRef, [
    { type: 'customer', stripeId: stringId(session.customer) },
    { type: 'subscription', stripeId: stringId(session.subscription) },
  ])
  if (session.status === 'open') {
    try {
      await stripe.checkout.sessions.expire(data.stripeId)
    } catch (error) {
      const current = await stripe.checkout.sessions.retrieve(data.stripeId)
      if (current.status === 'open') throw error
    }
  }
  await markCleanupResource(resource.ref, { status: 'completed', verified: true })
}

async function processSubscriptionCleanup({ resource, stripe, uid }) {
  const data = resource.data()
  let subscription
  try {
    subscription = await stripe.subscriptions.retrieve(data.stripeId)
  } catch (error) {
    if (error?.code === 'resource_missing') {
      await markCleanupResource(resource.ref, { status: 'completed' })
      return
    }
    throw error
  }
  if (data.verified !== true && subscription?.metadata?.firebaseUid !== uid) {
    await markCleanupResource(resource.ref, { status: 'completed', ownershipRejected: true })
    return
  }
  if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    try {
      await stripe.subscriptions.cancel(data.stripeId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
  }
  await markCleanupResource(resource.ref, { status: 'completed', verified: true })
}

async function processCustomerCleanup({ db, resource, stripe, tombstoneRef, uid }) {
  const data = resource.data()
  if (data.verified !== true) {
    const ownershipPage = await stripe.checkout.sessions.list({
      customer: data.stripeId,
      limit: 100,
      ...(data.ownershipCursor ? { starting_after: data.ownershipCursor } : {}),
    })
    if (!ownershipPage.data.some(session => stripeSessionBelongsToUser(session, uid))) {
      const ownershipCursor = stripePageCursor(ownershipPage)
      if (ownershipCursor) {
        await markCleanupResource(resource.ref, { ownershipCursor })
        return
      }
      await markCleanupResource(resource.ref, { status: 'completed', ownershipRejected: true })
      return
    }
    await markCleanupResource(resource.ref, {
      checkoutComplete: false,
      checkoutCursor: null,
      ownershipCursor: null,
      subscriptionComplete: false,
      subscriptionCursor: null,
      verified: true,
    })
    return
  }

  const [sessionPage, subscriptionPage] = await Promise.all([
    data.checkoutComplete === true ? null : stripe.checkout.sessions.list({
      customer: data.stripeId,
      limit: 100,
      ...(data.checkoutCursor ? { starting_after: data.checkoutCursor } : {}),
    }),
    data.subscriptionComplete === true ? null : stripe.subscriptions.list({
      customer: data.stripeId,
      status: 'all',
      limit: 100,
      ...(data.subscriptionCursor ? { starting_after: data.subscriptionCursor } : {}),
    }),
  ])
  await queueDiscoveredResources(db, tombstoneRef, [
    ...(sessionPage?.data || []).map(session => ({
      type: 'checkoutSession',
      stripeId: stringId(session.id),
    })),
    ...(subscriptionPage?.data || []).map(subscription => ({
      type: 'subscription',
      stripeId: stringId(subscription.id),
    })),
  ])
  const checkoutCursor = sessionPage ? stripePageCursor(sessionPage) : null
  const subscriptionCursor = subscriptionPage ? stripePageCursor(subscriptionPage) : null
  const checkoutComplete = data.checkoutComplete === true || checkoutCursor === null
  const subscriptionComplete = data.subscriptionComplete === true || subscriptionCursor === null
  await markCleanupResource(resource.ref, {
    checkoutComplete,
    checkoutCursor,
    status: checkoutComplete && subscriptionComplete ? 'completed' : 'pending',
    subscriptionComplete,
    subscriptionCursor,
    verified: true,
  })
}

async function finalizeAccountDeletion({ auth, db, tombstoneRef, uid, userRef }) {
  const tokenOwners = await db.collection('notificationTokenOwners').where('uid', '==', uid).get()
  await Promise.all(tokenOwners.docs.map(owner => owner.ref.delete()))
  await db.collection('notificationRegistrationLimits').doc(uid).delete()
  await db.recursiveDelete(userRef)
  try {
    await auth.deleteUser(uid)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }
  return db.runTransaction(async transaction => {
    const pendingQuery = tombstoneRef.collection('billingCleanupResources')
      .where('status', '==', 'pending').limit(1)
    const pending = await transaction.get(pendingQuery)
    if (!pending.empty) return false
    transaction.set(tombstoneRef, {
      cleanupCompletedAt: new Date(),
      cleanupStatus: 'completed',
    }, { merge: true })
    return true
  })
}

async function processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid }) {
  const userRef = db.collection('users').doc(uid)
  const tombstoneSnapshot = await tombstoneRef.get()
  if (!tombstoneSnapshot.exists || tombstoneSnapshot.data().cleanupStatus !== 'pending') {
    return { completed: tombstoneSnapshot.data()?.cleanupStatus === 'completed', processed: 0 }
  }
  const tombstone = tombstoneSnapshot.data()
  if (tombstone.resourceIndexComplete !== true) {
    let query = userRef.collection('billingResources').orderBy('__name__').limit(BILLING_INDEX_PAGE_SIZE)
    if (tombstone.resourceIndexCursor) query = query.startAfter(tombstone.resourceIndexCursor)
    const page = await query.get()
    await db.runTransaction(async transaction => {
      await queueBillingCleanup(transaction, tombstoneRef, page.docs.map(doc => ({
        ...doc.data(),
        verified: true,
      })), new Date())
      transaction.set(tombstoneRef, {
        resourceIndexComplete: page.docs.length < BILLING_INDEX_PAGE_SIZE,
        resourceIndexCursor: page.docs.at(-1)?.id || null,
      }, { merge: true })
    })
    return { completed: false, processed: page.docs.length }
  }

  const pending = await tombstoneRef.collection('billingCleanupResources')
    .where('status', '==', 'pending').limit(BILLING_CLEANUP_PAGE_SIZE).get()
  let processed = 0
  for (const resource of pending.docs) {
    try {
      const options = { db, resource, stripe, tombstoneRef, uid }
      if (resource.data().type === 'checkoutSession') await processCheckoutCleanup(options)
      if (resource.data().type === 'customer') await processCustomerCleanup(options)
      if (resource.data().type === 'subscription') await processSubscriptionCleanup(options)
      processed += 1
    } catch (error) {
      await markCleanupResource(resource.ref, {
        lastError: error?.message || 'Billing cleanup failed',
        lastFailedAt: new Date(),
      })
    }
  }
  await tombstoneRef.set({ cleanupUpdatedAt: new Date() }, { merge: true })
  if (!pending.empty) return { completed: false, processed }
  const completed = await finalizeAccountDeletion({ auth, db, tombstoneRef, uid, userRef })
  return { completed, processed }
}

async function processPendingAccountDeletions({ auth, db, stripe }) {
  const tombstones = await db.collection('accountDeletionTombstones')
    .where('cleanupStatus', '==', 'pending')
    .orderBy('cleanupUpdatedAt')
    .limit(10)
    .get()
  const results = []
  for (const tombstone of tombstones.docs) {
    results.push(await processAccountDeletionPage({
      auth,
      db,
      stripe,
      tombstoneRef: tombstone.ref,
      uid: tombstone.id,
    }))
  }
  return results
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
  await db.runTransaction(async transaction => {
    const [userSnapshot, tombstoneSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(tombstoneRef),
    ])
    const timestamp = new Date()
    const userData = userSnapshot.exists ? userSnapshot.data() : {}
    await queueBillingCleanup(transaction, tombstoneRef, [
      { type: 'checkoutSession', stripeId: userData.stripeCheckoutSessionId, verified: false },
      { type: 'customer', stripeId: userData.stripeCustomerId, verified: false },
      { type: 'subscription', stripeId: userData.stripeSubscriptionId, verified: false },
    ], timestamp)
    transaction.set(tombstoneRef, {
      cleanupStatus: 'pending',
      cleanupUpdatedAt: timestamp,
      createdAt: tombstoneSnapshot.exists ? tombstoneSnapshot.data().createdAt : timestamp,
      resourceIndexComplete: tombstoneSnapshot.exists
        ? tombstoneSnapshot.data().resourceIndexComplete === true
        : false,
      revokedBefore: Math.floor(Date.now() / 1000),
    }, { merge: true })
    if (userSnapshot.exists) {
      transaction.set(userRef, { accountDeletionStartedAt: timestamp }, { merge: true })
    }
  })
  return processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: identity.uid })
}

module.exports = {
  authenticate,
  deleteAccount,
  exportAccountData,
  processAccountDeletionPage,
  processPendingAccountDeletions,
  safeAccountData,
}
