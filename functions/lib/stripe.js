const { authenticate } = require('./account')
const {
  billingResourceRef,
  customerBelongsToUser,
  indexBillingResources,
  indexSubscriptionOwners,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
  subscriptionOwnerRef,
} = require('./billing-resources')
const { createHash, randomUUID } = require('node:crypto')

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const CHECKOUT_RESERVATION_MS = 24 * 60 * 60 * 1000
const CHECKOUT_CLEANUP_LEASE_MS = 5 * 60 * 1000
const CHECKOUT_CLEANUP_LIMIT = 10
const CHECKOUT_CLEANUP_MAX_RETRY_MS = 24 * 60 * 60 * 1000
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
    if (page.has_more && !startingAfter)
      throw new Error('Stripe subscription pagination was incomplete')
  } while (startingAfter)
  return subscriptions
}

async function neutralizeCheckoutSession(stripe, sessionId) {
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    if (error?.code === 'resource_missing') return
    throw error
  }
  if (session.status === 'expired') return
  if (session.status === 'open') {
    await stripe.checkout.sessions.expire(sessionId)
    return
  }
  if (session.status === 'complete') {
    const subscriptionId = stringId(session.subscription)
    if (!subscriptionId) throw new Error('Completed checkout session is missing its subscription')
    try {
      await stripe.subscriptions.cancel(subscriptionId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
    return
  }
  throw new Error('Checkout session has an unexpected status')
}

function checkoutCleanupTaskRef(db, sessionId) {
  const digest = createHash('sha256').update(sessionId).digest('base64url')
  return db.collection('stripeCheckoutCleanupTasks').doc(digest)
}

async function queueCheckoutCleanup(db, sessionId, uid) {
  const taskRef = checkoutCleanupTaskRef(db, sessionId)
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(taskRef)
    if (snapshot.exists && ['completed', 'pending'].includes(snapshot.data().status)) return
    const timestamp = new Date()
    transaction.set(
      taskRef,
      {
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: timestamp,
        processingToken: null,
        sessionId,
        status: 'pending',
        uid,
        updatedAt: timestamp,
      },
      { merge: true },
    )
  })
}

function checkoutCleanupRetryDelay(attemptCount) {
  return Math.min(
    60_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 10),
    CHECKOUT_CLEANUP_MAX_RETRY_MS,
  )
}

async function processPendingCheckoutCleanups({ db, stripe, now = new Date() }) {
  const tasks = await db
    .collection('stripeCheckoutCleanupTasks')
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt')
    .limit(CHECKOUT_CLEANUP_LIMIT)
    .get()
  const results = []
  for (const task of tasks.docs) {
    const processingToken = randomUUID()
    const claimed = await db.runTransaction(async transaction => {
      const current = await transaction.get(task.ref)
      if (!current.exists || current.data().status !== 'pending') return null
      const nextAttemptAt = dateMillis(current.data().nextAttemptAt)
      if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) return null
      transaction.set(
        task.ref,
        {
          nextAttemptAt: new Date(now.getTime() + CHECKOUT_CLEANUP_LEASE_MS),
          processingToken,
          updatedAt: now,
        },
        { merge: true },
      )
      return current.data()
    })
    if (!claimed) continue
    try {
      await neutralizeCheckoutSession(stripe, claimed.sessionId)
      await db.runTransaction(async transaction => {
        const current = await transaction.get(task.ref)
        if (!current.exists || current.data().processingToken !== processingToken) return
        transaction.set(
          task.ref,
          {
            completedAt: new Date(),
            nextAttemptAt: null,
            processingToken: null,
            status: 'completed',
            updatedAt: new Date(),
          },
          { merge: true },
        )
      })
      results.push({ id: task.id, completed: true })
    } catch (error) {
      await db.runTransaction(async transaction => {
        const current = await transaction.get(task.ref)
        if (!current.exists || current.data().processingToken !== processingToken) return
        const attemptCount = Number.isSafeInteger(current.data().attemptCount)
          ? current.data().attemptCount + 1
          : 1
        const timestamp = new Date()
        transaction.set(
          task.ref,
          {
            attemptCount,
            lastError: error?.message || 'Checkout cleanup failed',
            nextAttemptAt: new Date(timestamp.getTime() + checkoutCleanupRetryDelay(attemptCount)),
            processingToken: null,
            updatedAt: timestamp,
          },
          { merge: true },
        )
      })
      results.push({ id: task.id, completed: false })
    }
  }
  return results
}

function subscriptionHasPrice(subscription, expectedPriceId) {
  if (!expectedPriceId) return false
  const items = subscription?.items?.data
  return Array.isArray(items) && items.some(item => stringId(item?.price) === expectedPriceId)
}

async function validateCheckoutSession(
  stripe,
  session,
  expectedPriceId,
  { requirePaid = true } = {},
) {
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
  if (!customerId || !subscriptionId)
    throw new Error('Checkout session is missing subscription data')
  return { uid, customerId, subscriptionId, paid }
}

async function findUserBySubscription(db, stripe, subscription) {
  const subscriptionId = stringId(subscription?.id)
  const customerId = stringId(subscription?.customer)
  const metadataUid = subscription?.metadata?.firebaseUid
  if (metadataUid !== undefined && !validUid(metadataUid)) return null

  const ownerRef = subscriptionOwnerRef(db, subscriptionId)
  const ownerSnapshot = ownerRef ? await ownerRef.get() : null
  const owner = ownerSnapshot?.exists ? ownerSnapshot.data() : null
  const ownerUid = owner?.stripeId === subscriptionId && validUid(owner.uid) ? owner.uid : null
  if (ownerUid && metadataUid && ownerUid !== metadataUid) return null

  const authoritativeUid = ownerUid || metadataUid
  if (authoritativeUid) {
    const user = await db.collection('users').doc(authoritativeUid).get()
    return user.exists ? user : null
  }

  if (subscriptionId) {
    const indexed = await db
      .collectionGroup('billingResources')
      .where('stripeId', '==', subscriptionId)
      .limit(2)
      .get()
    const indexedOwners = new Map(
      indexed.docs
        .filter(doc => doc.data().type === 'subscription')
        .map(doc => [doc.ref.parent.parent.id, doc.ref.parent.parent]),
    )
    if (indexedOwners.size > 1) return null
    if (indexedOwners.size === 1) {
      const user = await [...indexedOwners.values()][0].get()
      return user.exists ? user : null
    }
  }
  if (subscriptionId) {
    const bySubscription = await db
      .collection('users')
      .where('stripeSubscriptionId', '==', subscriptionId)
      .limit(2)
      .get()
    if (bySubscription.docs.length > 1) return null
    if (bySubscription.docs.length === 1) return bySubscription.docs[0]
  }
  if (customerId) {
    const indexed = await db
      .collectionGroup('billingResources')
      .where('stripeId', '==', customerId)
      .limit(2)
      .get()
    const indexedOwners = new Map(
      indexed.docs
        .filter(doc => doc.data().type === 'customer')
        .map(doc => [doc.ref.parent.parent.id, doc.ref.parent.parent]),
    )
    if (indexedOwners.size > 1) return null
    if (indexedOwners.size === 1) {
      const candidateRef = [...indexedOwners.values()][0]
      if (!(await customerBelongsToUser(stripe, customerId, candidateRef.id))) return null
      const user = await candidateRef.get()
      return user.exists ? user : null
    }

    const byCustomer = await db
      .collection('users')
      .where('stripeCustomerId', '==', customerId)
      .limit(2)
      .get()
    if (byCustomer.docs.length > 1) return null
    if (byCustomer.docs.length === 1) {
      const candidate = byCustomer.docs[0]
      if (await customerBelongsToUser(stripe, customerId, candidate.ref.id)) return candidate
    }
  }
  return null
}

async function findTombstonedUserRef(db, subscription) {
  const subscriptionId = stringId(subscription?.id)
  const ownerRef = subscriptionOwnerRef(db, subscriptionId)
  const ownerSnapshot = ownerRef ? await ownerRef.get() : null
  const owner = ownerSnapshot?.exists ? ownerSnapshot.data() : null
  const uid =
    owner?.stripeId === subscriptionId && validUid(owner.uid)
      ? owner.uid
      : subscription?.metadata?.firebaseUid
  if (!validUid(uid)) return null
  const tombstone = await db.collection('accountDeletionTombstones').doc(uid).get()
  return tombstone.exists ? db.collection('users').doc(uid) : null
}

function eventIsNewer(event, userData) {
  const previousCreated = userData?.stripeEventCreated
  if (!Number.isFinite(previousCreated)) return true
  if (event.created !== previousCreated) return event.created > previousCreated
  return (EVENT_PRIORITY[event.type] ?? -1) >= (userData.stripeEventPriority ?? -1)
}

async function commitEvent(
  db,
  event,
  userRef,
  buildUserData,
  serverTimestamp,
  cancellationSubscriptionId = null,
  billingResources = [],
) {
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  return db.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    const duplicate = eventSnapshot.exists
    const eventData = duplicate ? eventSnapshot.data() : null
    let applied = false
    let accountDeleted = false
    let rejected = false
    let cancellationPending = false
    let pendingCancellationSubscriptionId = null
    if (userRef && buildUserData) {
      const tombstoneRef = db.collection('accountDeletionTombstones').doc(userRef.id)
      const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      accountDeleted =
        tombstoneSnapshot.exists ||
        !userSnapshot.exists ||
        !!userSnapshot.data().accountDeletionStartedAt
      if (!accountDeleted) {
        const userData = buildUserData(userSnapshot.data())
        rejected = !userData
        indexBillingResources(transaction, db, userRef, billingResources, serverTimestamp())
        if (userData && !duplicate && eventIsNewer(event, userSnapshot.data())) {
          transaction.set(
            userRef,
            {
              ...userData,
              stripeEventCreated: event.created,
              stripeEventPriority: EVENT_PRIORITY[event.type],
            },
            { merge: true },
          )
          applied = true
        }
      }
    }

    if (
      eventData?.cancellationStatus === 'pending' &&
      typeof eventData.cancellationSubscriptionId === 'string' &&
      eventData.cancellationSubscriptionId
    ) {
      cancellationPending = true
      pendingCancellationSubscriptionId = eventData.cancellationSubscriptionId
    } else if (
      cancellationSubscriptionId &&
      (accountDeleted || rejected) &&
      eventData?.cancellationStatus !== 'completed'
    ) {
      cancellationPending = true
      pendingCancellationSubscriptionId = cancellationSubscriptionId
      if (duplicate) {
        transaction.set(
          eventRef,
          {
            cancellationSubscriptionId: pendingCancellationSubscriptionId,
            cancellationStatus: 'pending',
          },
          { merge: true },
        )
      }
    }
    if (!duplicate) {
      transaction.create(eventRef, {
        type: event.type,
        created: event.created,
        processedAt: serverTimestamp(),
        ...(cancellationPending
          ? {
              cancellationSubscriptionId,
              cancellationStatus: 'pending',
            }
          : {}),
      })
    }
    return {
      duplicate,
      applied,
      accountDeleted,
      rejected,
      cancellationPending,
      cancellationSubscriptionId: pendingCancellationSubscriptionId,
    }
  })
}

async function completePendingCancellation({ db, event, result, serverTimestamp, stripe }) {
  if (!result.cancellationPending) return
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  const subscriptionId = result.cancellationSubscriptionId
  try {
    await stripe.subscriptions.cancel(subscriptionId)
  } catch (error) {
    if (error?.code !== 'resource_missing') throw error
  }
  await eventRef.set(
    {
      cancellationStatus: 'completed',
      cancellationCompletedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

async function processStripeEvent({ db, event, expectedPriceId, serverTimestamp, stripe }) {
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
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
    const active =
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) &&
      subscriptionHasPrice(subscription, expectedPriceId)
    const checkoutStatus =
      event.type === 'checkout.session.async_payment_failed'
        ? 'failed'
        : paid && active
          ? 'succeeded'
          : 'pending'

    const result = await commitEvent(
      db,
      event,
      userRef,
      userData => {
        if (
          userData.stripeSubscriptionId &&
          userData.stripeSubscriptionId !== subscriptionId &&
          !TERMINAL_SUBSCRIPTION_STATUSES.has(userData.subscriptionStatus)
        )
          return null
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
      },
      serverTimestamp,
      subscriptionId,
      [
        { type: 'checkoutSession', stripeId: session.id },
        { type: 'customer', stripeId: customerId },
        { type: 'subscription', stripeId: subscriptionId },
      ],
    )
    await completePendingCancellation({ db, event, result, serverTimestamp, stripe })
    return result
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object
    const user = await findUserBySubscription(db, stripe, subscription)
    const userRef = user?.ref || (await findTombstonedUserRef(db, subscription))
    if (!userRef) {
      if (event.type === 'customer.subscription.deleted') {
        return commitEvent(db, event, null, null, serverTimestamp)
      }
      throw new Error('Subscription account does not exist')
    }

    const currentSubscription =
      event.type === 'customer.subscription.updated'
        ? await stripe.subscriptions.retrieve(subscription.id)
        : subscription
    const active =
      event.type !== 'customer.subscription.deleted' &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(currentSubscription.status) &&
      subscriptionHasPrice(currentSubscription, expectedPriceId)
    const checkoutStatus = active
      ? 'succeeded'
      : TERMINAL_SUBSCRIPTION_STATUSES.has(currentSubscription.status) ||
          currentSubscription.status === 'unpaid'
        ? 'failed'
        : null
    const update = {
      tier: active ? 'paid' : 'free',
      stripeCustomerId: stringId(currentSubscription.customer),
      stripeSubscriptionId: stringId(currentSubscription.id),
      subscriptionStatus:
        event.type === 'customer.subscription.deleted' ? 'canceled' : currentSubscription.status,
      subscriptionUpdatedAt: serverTimestamp(),
    }
    if (!active) update.proSince = null
    const cancellationSubscriptionId = !TERMINAL_SUBSCRIPTION_STATUSES.has(
      currentSubscription.status,
    )
      ? stringId(currentSubscription.id)
      : null
    const result = await commitEvent(
      db,
      event,
      userRef,
      userData => {
        const currentSubscriptionId = userData.stripeSubscriptionId
        if (currentSubscriptionId && currentSubscriptionId !== stringId(subscription.id))
          return null
        return checkoutStatus ? { ...update, stripeCheckoutStatus: checkoutStatus } : update
      },
      serverTimestamp,
      cancellationSubscriptionId,
      [
        { type: 'customer', stripeId: stringId(currentSubscription.customer) },
        { type: 'subscription', stripeId: stringId(currentSubscription.id) },
      ],
    )
    await completePendingCancellation({ db, event, result, serverTimestamp, stripe })
    return result
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
  const reserveCheckout = expiredSessionId =>
    db.runTransaction(async transaction => {
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
      if (
        current.stripeSubscriptionId &&
        !TERMINAL_SUBSCRIPTION_STATUSES.has(current.subscriptionStatus)
      ) {
        const error = new Error('Account already has a subscription')
        error.status = 409
        throw error
      }
      const reservedBy = current.stripeCheckoutAttemptId
      const reservedUntil = dateMillis(current.stripeCheckoutReservedUntil)
      const sessionId = current.stripeCheckoutSessionId
      if (
        current.stripeCheckoutStatus === 'pending' &&
        typeof sessionId === 'string' &&
        sessionId &&
        sessionId !== expiredSessionId
      ) {
        return { reuseSessionId: sessionId }
      }
      if (
        reservedBy &&
        reservedBy !== attemptId &&
        reservedUntil > now &&
        sessionId !== expiredSessionId
      ) {
        const error = new Error('Checkout is already in progress')
        error.status = 409
        throw error
      }
      transaction.set(
        userRef,
        {
          stripeCheckoutAttemptId: attemptId,
          stripeCheckoutSessionId: null,
          stripeCheckoutReservedUntil: new Date(now + CHECKOUT_RESERVATION_MS),
          stripeCheckoutStatus: 'creating',
        },
        { merge: true },
      )
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
    const owned = existing && stripeSessionBelongsToUser(existing, identity.uid)
    if (owned && existing.status === 'open' && existing.url) return existing
    if (owned && existing.status === 'complete') {
      const error = new Error('Checkout payment is being processed')
      error.status = 409
      throw error
    }
    reservation = await reserveCheckout(reservation.reuseSessionId)
  }
  const userData = reservation.userData

  const releaseReservation = async () =>
    db.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef)
      if (!snapshot.exists || snapshot.data().stripeCheckoutAttemptId !== attemptId) return
      transaction.set(
        userRef,
        {
          stripeCheckoutAttemptId: null,
          stripeCheckoutReservedUntil: null,
          stripeCheckoutStatus: 'failed',
        },
        { merge: true },
      )
    })

  const customer =
    typeof userData.stripeCustomerId === 'string' && userData.stripeCustomerId
      ? { customer: userData.stripeCustomerId }
      : { customer_email: identity.email }
  let createdSessionId = null
  let cleanupQueued = false
  try {
    if (customer.customer) {
      const customerRef = billingResourceRef(userRef, 'customer', customer.customer)
      const indexedCustomer = await customerRef.get()
      if (
        !indexedCustomer.exists &&
        !(await customerBelongsToUser(stripe, customer.customer, identity.uid))
      ) {
        const error = new Error('Billing account ownership could not be verified')
        error.status = 409
        throw error
      }
      const subscriptions = await listCustomerSubscriptions(stripe, customer.customer)
      if (
        subscriptions.some(subscription => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status))
      ) {
        const error = new Error('Account already has a subscription')
        error.status = 409
        throw error
      }
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: expectedPriceId, quantity: 1 }],
        client_reference_id: identity.uid,
        ...customer,
        metadata: { firebaseUid: identity.uid },
        subscription_data: { metadata: { firebaseUid: identity.uid } },
        success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=canceled`,
        allow_promotion_codes: true,
      },
      {
        idempotencyKey: `checkout:${createHash('sha256')
          .update(`${identity.uid}\0${expectedPriceId}\0${attemptId}`)
          .digest('hex')}`,
      },
    )
    createdSessionId = session.id
    const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
    const persistence = await db.runTransaction(async transaction => {
      const [snapshot, tombstone] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      const deletionStarted =
        !snapshot.exists || tombstone.exists || snapshot.data().accountDeletionStartedAt
      if (deletionStarted) {
        const resources = [
          { type: 'checkoutSession', stripeId: session.id },
          { type: 'customer', stripeId: stringId(session.customer) || customer.customer },
          { type: 'subscription', stripeId: stringId(session.subscription) },
        ]
        const timestamp = new Date()
        await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
        indexSubscriptionOwners(transaction, db, identity.uid, resources, timestamp)
        return { deletionStarted: true, persisted: false }
      }
      if (snapshot.data().stripeCheckoutAttemptId !== attemptId) {
        return { deletionStarted: false, persisted: false }
      }
      transaction.set(
        userRef,
        {
          stripeCheckoutSessionId: session.id,
          stripeCheckoutStatus: 'pending',
          stripeCheckoutReservedUntil: Number.isFinite(session.expires_at)
            ? new Date(session.expires_at * 1000)
            : new Date(now + CHECKOUT_RESERVATION_MS),
        },
        { merge: true },
      )
      indexBillingResources(
        transaction,
        db,
        userRef,
        [
          { type: 'checkoutSession', stripeId: session.id },
          { type: 'customer', stripeId: stringId(session.customer) || customer.customer },
        ],
        new Date(),
      )
      return { deletionStarted: false, persisted: true }
    })
    cleanupQueued = persistence.deletionStarted
    if (!persistence.persisted) {
      const error = new Error(
        persistence.deletionStarted
          ? 'Account deletion is in progress'
          : 'Checkout reservation changed',
      )
      error.status = 409
      throw error
    }
    return session
  } catch (error) {
    let failure = error
    try {
      if (createdSessionId) {
        try {
          await neutralizeCheckoutSession(stripe, createdSessionId)
        } catch (cleanupError) {
          failure = cleanupError
          if (!cleanupQueued) {
            try {
              await queueCheckoutCleanup(db, createdSessionId, identity.uid)
            } catch (queueError) {
              failure = new AggregateError(
                [cleanupError, queueError],
                'Checkout cleanup failed and could not be queued',
              )
            }
          }
        }
      }
    } finally {
      await releaseReservation()
    }
    throw failure
  }
}

async function createBillingPortal({ appUrl, auth, db, req, stripe }) {
  const identity = await authenticate(auth, req.headers.authorization)
  if (!validUid(identity.uid)) {
    const error = new Error('Invalid account')
    error.status = 401
    throw error
  }
  const userRef = db.collection('users').doc(identity.uid)
  const userSnapshot = await userRef.get()
  const customerId = userSnapshot.exists ? userSnapshot.data().stripeCustomerId : null
  if (typeof customerId !== 'string' || !customerId) {
    const error = new Error('No billing account exists')
    error.status = 404
    throw error
  }
  if (userSnapshot.data().accountDeletionStartedAt) {
    const error = new Error('Account deletion is in progress')
    error.status = 409
    throw error
  }
  const customerRef = billingResourceRef(userRef, 'customer', customerId)
  const indexedCustomer = await customerRef.get()
  if (!indexedCustomer.exists) {
    const owned = await customerBelongsToUser(stripe, customerId, identity.uid)
    if (!owned) {
      const error = new Error('No verified billing account exists')
      error.status = 404
      throw error
    }
    await db.runTransaction(async transaction => {
      const [currentUser, tombstone, currentIndex] = await Promise.all([
        transaction.get(userRef),
        transaction.get(db.collection('accountDeletionTombstones').doc(identity.uid)),
        transaction.get(customerRef),
      ])
      if (
        !currentUser.exists ||
        tombstone.exists ||
        currentUser.data().accountDeletionStartedAt ||
        currentUser.data().stripeCustomerId !== customerId
      ) {
        const error = new Error('Account deletion is in progress')
        error.status = 409
        throw error
      }
      if (!currentIndex.exists) {
        indexBillingResources(
          transaction,
          db,
          userRef,
          [{ type: 'customer', stripeId: customerId }],
          new Date(),
        )
      }
    })
  }
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/account/`,
  })
}

async function backfillBillingResourcePage({ db, serverTimestamp, stripe }) {
  const stateRef = db.collection('systemMigrations').doc('stripeBillingResourceOwnersV1')
  const stateSnapshot = await stateRef.get()
  const state = stateSnapshot.exists ? stateSnapshot.data() : {}
  if (state.completed === true) return { completed: true, processed: 0 }

  const page = await stripe.checkout.sessions.list({
    limit: 100,
    ...(state.startingAfter ? { starting_after: state.startingAfter } : {}),
  })
  let processed = 0
  for (const session of page.data) {
    const uid = session.client_reference_id || session.metadata?.firebaseUid
    if (!validUid(uid) || !stripeSessionBelongsToUser(session, uid)) continue
    const userRef = db.collection('users').doc(uid)
    const resources = [
      { type: 'checkoutSession', stripeId: stringId(session.id) },
      { type: 'customer', stripeId: stringId(session.customer) },
      { type: 'subscription', stripeId: stringId(session.subscription) },
    ]
    const indexed = await db.runTransaction(async transaction => {
      const tombstoneRef = db.collection('accountDeletionTombstones').doc(uid)
      const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      if (
        !userSnapshot.exists ||
        tombstoneSnapshot.exists ||
        userSnapshot.data().accountDeletionStartedAt
      ) {
        const timestamp = serverTimestamp()
        await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
        indexSubscriptionOwners(transaction, db, uid, resources, timestamp)
        transaction.set(
          tombstoneRef,
          {
            cleanupStatus: 'pending',
            ...(tombstoneSnapshot.exists
              ? {}
              : {
                  cleanupAttemptCount: 0,
                  cleanupLastError: null,
                  cleanupNextAttemptAt: serverTimestamp(),
                  cleanupUpdatedAt: serverTimestamp(),
                }),
            createdAt: tombstoneSnapshot.exists
              ? tombstoneSnapshot.data().createdAt
              : serverTimestamp(),
            resourceIndexComplete: !userSnapshot.exists,
          },
          { merge: true },
        )
        return false
      }
      indexBillingResources(transaction, db, userRef, resources, serverTimestamp())
      return true
    })
    if (indexed) processed += 1
  }

  const startingAfter = page.has_more ? stringId(page.data.at(-1)) : null
  if (page.has_more && !startingAfter) throw new Error('Stripe checkout pagination was incomplete')
  const pass = Number.isInteger(state.pass) ? state.pass : 1
  const completed = !page.has_more && pass >= 2
  await stateRef.set(
    {
      completed,
      pass: page.has_more ? pass : pass + 1,
      processedAt: serverTimestamp(),
      startingAfter,
    },
    { merge: true },
  )
  return { completed, processed }
}

module.exports = {
  backfillBillingResourcePage,
  createBillingPortal,
  createCheckout,
  findUserBySubscription,
  listCustomerSubscriptions,
  processStripeEvent,
  processPendingCheckoutCleanups,
  subscriptionHasPrice,
  validAttemptId,
  validUid,
  validateCheckoutSession,
}
