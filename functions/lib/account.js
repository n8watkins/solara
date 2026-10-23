const {
  indexSubscriptionOwners,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
} = require('./billing-resources')
const { randomUUID } = require('node:crypto')

const PORTABLE_ACCOUNT_FIELDS = new Set([
  'activeProfileId',
  'activities',
  'calendarHours',
  'collapsedActivityCategories',
  'hiddenActivitySuggestionIds',
  'location',
  'notificationHour',
  'onboardingComplete',
  'profiles',
  'savedLocations',
  'schemaVersion',
  'showSunPath',
  'skinType',
  'sunscreen',
  'tier',
  'timezone',
  'uid',
  'upgradeInterest',
])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const BILLING_INDEX_PAGE_SIZE = 25
const BILLING_CLEANUP_PAGE_SIZE = 10
const BILLING_CLEANUP_LEASE_MS = 5 * 60 * 1000
const BILLING_CLEANUP_RETRY_BASE_MS = 5 * 60 * 1000
const BILLING_CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1000

function cleanupRetryDelay(attemptCount) {
  return Math.min(
    BILLING_CLEANUP_RETRY_BASE_MS * 2 ** Math.min(attemptCount - 1, 30),
    BILLING_CLEANUP_RETRY_MAX_MS,
  )
}

function timestampMillis(value) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return Number.NaN
}

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
    Object.entries(data || {}).filter(([key]) => PORTABLE_ACCOUNT_FIELDS.has(key)),
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
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  const devicesQuery = userRef.collection('notificationDevices')
  const { userSnapshot, devicesSnapshot } = await db.runTransaction(async transaction => {
    const tombstone = await transaction.get(tombstoneRef)
    if (tombstone.exists) {
      const error = new Error('Account deletion is in progress')
      error.status = 409
      throw error
    }
    const [account, devices] = await Promise.all([
      transaction.get(userRef),
      transaction.get(devicesQuery),
    ])
    return { userSnapshot: account, devicesSnapshot: devices }
  })
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data()) : null,
    notificationDevices: safeDeviceData(devicesSnapshot),
  }
}

async function ensureSessionsRevoked(auth, db, tombstoneRef, tombstone, uid) {
  if (tombstone.sessionsRevokedAt) return
  await auth.revokeRefreshTokens(uid)
  await db.runTransaction(async transaction => {
    const current = await transaction.get(tombstoneRef)
    if (!current.exists || current.data().cleanupStatus !== 'pending') return
    if (!current.data().sessionsRevokedAt) {
      transaction.set(tombstoneRef, { sessionsRevokedAt: new Date() }, { merge: true })
    }
  })
}

async function markCleanupResource(db, resource, data) {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(resource.ref)
    if (
      !current.exists ||
      current.data().status !== 'pending' ||
      current.data().processingToken !== resource.data().processingToken
    ) {
      return false
    }
    const timestamp = new Date()
    transaction.set(
      resource.ref,
      {
        ...data,
        nextAttemptAt: data.status === 'completed' ? null : timestamp,
        processingToken: null,
        updatedAt: timestamp,
      },
      { merge: true },
    )
    return true
  })
}

async function markCleanupFailure(db, resource, error) {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(resource.ref)
    if (
      !current.exists ||
      current.data().status !== 'pending' ||
      current.data().processingToken !== resource.data().processingToken
    ) {
      return false
    }
    const timestamp = new Date()
    const attemptCount = Number.isSafeInteger(current.data().attemptCount)
      ? current.data().attemptCount + 1
      : 1
    const delay = cleanupRetryDelay(attemptCount)
    transaction.set(
      resource.ref,
      {
        attemptCount,
        lastError: error?.message || 'Billing cleanup failed',
        lastFailedAt: timestamp,
        nextAttemptAt: new Date(timestamp.getTime() + delay),
        processingToken: null,
        updatedAt: timestamp,
      },
      { merge: true },
    )
    return true
  })
}

async function markAccountCleanupFailure(db, tombstoneRef, error) {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(tombstoneRef)
    if (!current.exists || current.data().cleanupStatus !== 'pending') return false
    const timestamp = new Date()
    const attemptCount = Number.isSafeInteger(current.data().cleanupAttemptCount)
      ? current.data().cleanupAttemptCount + 1
      : 1
    const nextAttemptAt = new Date(timestamp.getTime() + cleanupRetryDelay(attemptCount))
    transaction.set(
      tombstoneRef,
      {
        cleanupAttemptCount: attemptCount,
        cleanupLastError: error?.message || 'Account deletion cleanup failed',
        cleanupLastFailedAt: timestamp,
        cleanupNextAttemptAt: nextAttemptAt,
        cleanupUpdatedAt: nextAttemptAt,
      },
      { merge: true },
    )
    return true
  })
}

async function claimCleanupResources(db, tombstoneRef) {
  const timestamp = new Date()
  const query = tombstoneRef
    .collection('billingCleanupResources')
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', timestamp)
    .orderBy('nextAttemptAt')
    .limit(BILLING_CLEANUP_PAGE_SIZE)
  return db.runTransaction(async transaction => {
    const pending = await transaction.get(query)
    return pending.docs.map(resource => {
      const processingToken = randomUUID()
      transaction.set(
        resource.ref,
        {
          nextAttemptAt: new Date(timestamp.getTime() + BILLING_CLEANUP_LEASE_MS),
          processingToken,
          updatedAt: timestamp,
        },
        { merge: true },
      )
      return {
        id: resource.id,
        ref: resource.ref,
        data: () => ({ ...resource.data(), processingToken }),
      }
    })
  })
}

async function queueDiscoveredResources(db, tombstoneRef, uid, resources) {
  await db.runTransaction(async transaction => {
    const timestamp = new Date()
    await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
    indexSubscriptionOwners(transaction, db, uid, resources, timestamp)
  })
}

async function processCheckoutCleanup({ db, resource, stripe, tombstoneRef, uid }) {
  const data = resource.data()
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(data.stripeId)
  } catch (error) {
    if (error?.code === 'resource_missing') {
      await markCleanupResource(db, resource, { status: 'completed' })
      return
    }
    throw error
  }
  if (data.verified !== true && !stripeSessionBelongsToUser(session, uid)) {
    await markCleanupResource(db, resource, { status: 'completed', ownershipRejected: true })
    return
  }
  await queueDiscoveredResources(db, tombstoneRef, uid, [
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
  await markCleanupResource(db, resource, { status: 'completed', verified: true })
}

async function processSubscriptionCleanup({ db, resource, stripe, uid }) {
  const data = resource.data()
  let subscription
  try {
    subscription = await stripe.subscriptions.retrieve(data.stripeId)
  } catch (error) {
    if (error?.code === 'resource_missing') {
      await markCleanupResource(db, resource, { status: 'completed' })
      return
    }
    throw error
  }
  if (data.verified !== true && subscription?.metadata?.firebaseUid !== uid) {
    await markCleanupResource(db, resource, { status: 'completed', ownershipRejected: true })
    return
  }
  if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    try {
      await stripe.subscriptions.cancel(data.stripeId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
  }
  await markCleanupResource(db, resource, { status: 'completed', verified: true })
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
        await markCleanupResource(db, resource, { ownershipCursor })
        return
      }
      await markCleanupResource(db, resource, { status: 'completed', ownershipRejected: true })
      return
    }
    await markCleanupResource(db, resource, {
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
    data.checkoutComplete === true
      ? null
      : stripe.checkout.sessions.list({
          customer: data.stripeId,
          limit: 100,
          ...(data.checkoutCursor ? { starting_after: data.checkoutCursor } : {}),
        }),
    data.subscriptionComplete === true
      ? null
      : stripe.subscriptions.list({
          customer: data.stripeId,
          status: 'all',
          limit: 100,
          ...(data.subscriptionCursor ? { starting_after: data.subscriptionCursor } : {}),
        }),
  ])
  await queueDiscoveredResources(db, tombstoneRef, uid, [
    ...(sessionPage?.data || [])
      .filter(session => stripeSessionBelongsToUser(session, uid))
      .map(session => ({
        type: 'checkoutSession',
        stripeId: stringId(session.id),
      })),
    ...(subscriptionPage?.data || [])
      .filter(subscription => subscription?.metadata?.firebaseUid === uid)
      .map(subscription => ({
        type: 'subscription',
        stripeId: stringId(subscription.id),
      })),
  ])
  const checkoutCursor = sessionPage ? stripePageCursor(sessionPage) : null
  const subscriptionCursor = subscriptionPage ? stripePageCursor(subscriptionPage) : null
  const checkoutComplete = data.checkoutComplete === true || checkoutCursor === null
  const subscriptionComplete = data.subscriptionComplete === true || subscriptionCursor === null
  await markCleanupResource(db, resource, {
    checkoutComplete,
    checkoutCursor,
    status: checkoutComplete && subscriptionComplete ? 'completed' : 'pending',
    subscriptionComplete,
    subscriptionCursor,
    verified: true,
  })
}

async function finalizeAccountDeletion({ auth, db, tombstoneRef, uid, userRef }) {
  const timestamp = new Date()
  const finalizationToken = randomUUID()
  const pendingQuery = tombstoneRef
    .collection('billingCleanupResources')
    .where('status', '==', 'pending')
    .limit(1)
  const acquired = await db.runTransaction(async transaction => {
    const [tombstoneSnapshot, pending] = await Promise.all([
      transaction.get(tombstoneRef),
      transaction.get(pendingQuery),
    ])
    const tombstone = tombstoneSnapshot.exists ? tombstoneSnapshot.data() : {}
    const leaseExpiresAt =
      tombstone.finalizationLeaseExpiresAt?.toDate?.() || tombstone.finalizationLeaseExpiresAt
    if (
      tombstone.cleanupStatus !== 'pending' ||
      !pending.empty ||
      (leaseExpiresAt instanceof Date && leaseExpiresAt > timestamp)
    ) {
      return false
    }
    transaction.set(
      tombstoneRef,
      {
        finalizationLeaseExpiresAt: new Date(timestamp.getTime() + BILLING_CLEANUP_LEASE_MS),
        finalizationToken,
      },
      { merge: true },
    )
    return true
  })
  if (!acquired) return false

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
    const [tombstoneSnapshot, pending] = await Promise.all([
      transaction.get(tombstoneRef),
      transaction.get(pendingQuery),
    ])
    if (tombstoneSnapshot.data()?.finalizationToken !== finalizationToken) return false
    if (!pending.empty) {
      transaction.set(
        tombstoneRef,
        {
          finalizationLeaseExpiresAt: null,
          finalizationToken: null,
        },
        { merge: true },
      )
      return false
    }
    transaction.set(
      tombstoneRef,
      {
        cleanupCompletedAt: new Date(),
        cleanupStatus: 'completed',
        finalizationLeaseExpiresAt: null,
        finalizationToken: null,
      },
      { merge: true },
    )
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
  await ensureSessionsRevoked(auth, db, tombstoneRef, tombstone, uid)
  if (tombstone.resourceIndexComplete !== true) {
    let query = userRef
      .collection('billingResources')
      .orderBy('__name__')
      .limit(BILLING_INDEX_PAGE_SIZE)
    if (tombstone.resourceIndexCursor) query = query.startAfter(tombstone.resourceIndexCursor)
    const page = await query.get()
    const indexed = await db.runTransaction(async transaction => {
      const current = await transaction.get(tombstoneRef)
      const currentData = current.exists ? current.data() : {}
      if (
        currentData.cleanupStatus !== 'pending' ||
        currentData.resourceIndexComplete === true ||
        currentData.resourceIndexCursor !== tombstone.resourceIndexCursor
      ) {
        return false
      }
      const resources = page.docs.map(doc => ({
        ...doc.data(),
        verified: true,
      }))
      const timestamp = new Date()
      await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
      indexSubscriptionOwners(transaction, db, uid, resources, timestamp)
      transaction.set(
        tombstoneRef,
        {
          cleanupAttemptCount: 0,
          cleanupLastError: null,
          cleanupNextAttemptAt: timestamp,
          cleanupUpdatedAt: timestamp,
          resourceIndexComplete: page.docs.length < BILLING_INDEX_PAGE_SIZE,
          resourceIndexCursor: page.docs.at(-1)?.id || null,
        },
        { merge: true },
      )
      return true
    })
    return { completed: false, processed: indexed ? page.docs.length : 0 }
  }

  const pending = await claimCleanupResources(db, tombstoneRef)
  let processed = 0
  for (const resource of pending) {
    try {
      const options = { db, resource, stripe, tombstoneRef, uid }
      if (resource.data().type === 'checkoutSession') await processCheckoutCleanup(options)
      if (resource.data().type === 'customer') await processCustomerCleanup(options)
      if (resource.data().type === 'subscription') await processSubscriptionCleanup(options)
      processed += 1
    } catch (error) {
      await markCleanupFailure(db, resource, error)
    }
  }
  const timestamp = new Date()
  await tombstoneRef.set(
    {
      cleanupAttemptCount: 0,
      cleanupLastError: null,
      cleanupNextAttemptAt: timestamp,
      cleanupUpdatedAt: timestamp,
    },
    { merge: true },
  )
  if (pending.length > 0) return { completed: false, processed }
  const completed = await finalizeAccountDeletion({ auth, db, tombstoneRef, uid, userRef })
  return { completed, processed }
}

async function processPendingAccountDeletions({ auth, db, stripe, now = new Date() }) {
  const tombstones = await db
    .collection('accountDeletionTombstones')
    .where('cleanupStatus', '==', 'pending')
    .orderBy('cleanupUpdatedAt')
    .limit(10)
    .get()
  const results = []
  const failures = []
  for (const tombstone of tombstones.docs) {
    const nextAttemptAt = tombstone.data?.().cleanupNextAttemptAt
    const nextAttemptAtMs = timestampMillis(nextAttemptAt)
    if (Number.isFinite(nextAttemptAtMs) && nextAttemptAtMs > now.getTime()) continue
    try {
      results.push(
        await processAccountDeletionPage({
          auth,
          db,
          stripe,
          tombstoneRef: tombstone.ref,
          uid: tombstone.id,
        }),
      )
    } catch (error) {
      try {
        await markAccountCleanupFailure(db, tombstone.ref, error)
      } catch (persistenceError) {
        failures.push(
          new Error(`Could not persist cleanup failure for ${tombstone.id}`, {
            cause: persistenceError,
          }),
        )
        continue
      }
      failures.push(
        new Error(`Account deletion cleanup failed for ${tombstone.id}`, {
          cause: error,
        }),
      )
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} account deletion cleanup task(s) failed`)
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
    if (tombstoneSnapshot.data()?.cleanupStatus === 'completed') return
    await queueBillingCleanup(
      transaction,
      tombstoneRef,
      [
        { type: 'checkoutSession', stripeId: userData.stripeCheckoutSessionId, verified: false },
        { type: 'customer', stripeId: userData.stripeCustomerId, verified: false },
        { type: 'subscription', stripeId: userData.stripeSubscriptionId, verified: false },
      ],
      timestamp,
    )
    transaction.set(
      tombstoneRef,
      {
        cleanupAttemptCount: 0,
        cleanupLastError: null,
        cleanupNextAttemptAt: timestamp,
        cleanupStatus: 'pending',
        cleanupUpdatedAt: timestamp,
        createdAt: tombstoneSnapshot.exists ? tombstoneSnapshot.data().createdAt : timestamp,
        resourceIndexComplete: tombstoneSnapshot.exists
          ? tombstoneSnapshot.data().resourceIndexComplete === true
          : false,
        revokedBefore: Math.floor(Date.now() / 1000),
      },
      { merge: true },
    )
    if (userSnapshot.exists) {
      transaction.set(userRef, { accountDeletionStartedAt: timestamp }, { merge: true })
    }
  })
  try {
    return await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: identity.uid })
  } catch (error) {
    await markAccountCleanupFailure(db, tombstoneRef, error).catch(() => false)
    return { completed: false, processed: 0 }
  }
}

module.exports = {
  authenticate,
  deleteAccount,
  exportAccountData,
  processAccountDeletionPage,
  processPendingAccountDeletions,
  safeAccountData,
}
