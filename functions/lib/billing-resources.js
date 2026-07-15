const { createHash } = require('node:crypto')

const BILLING_RESOURCE_TYPES = new Set(['checkoutSession', 'customer', 'subscription'])

function validBillingResource(type, stripeId) {
  return BILLING_RESOURCE_TYPES.has(type) && typeof stripeId === 'string' && stripeId.length > 0
}

function billingResourceRef(userRef, type, stripeId) {
  if (!validBillingResource(type, stripeId)) return null
  const digest = createHash('sha256').update(`${type}\0${stripeId}`).digest('base64url')
  return userRef.collection('billingResources').doc(`${type}_${digest}`)
}

function billingCleanupResourceRef(tombstoneRef, type, stripeId) {
  if (!validBillingResource(type, stripeId)) return null
  const digest = createHash('sha256').update(`${type}\0${stripeId}`).digest('base64url')
  return tombstoneRef.collection('billingCleanupResources').doc(`${type}_${digest}`)
}

function subscriptionOwnerRef(db, stripeId) {
  if (!validBillingResource('subscription', stripeId)) return null
  const digest = createHash('sha256').update(stripeId).digest('base64url')
  return db.collection('stripeSubscriptionOwners').doc(digest)
}

function indexSubscriptionOwners(transaction, db, uid, resources, timestamp) {
  for (const { type, stripeId, verified = true } of resources) {
    if (type !== 'subscription' || verified === false) continue
    const ref = subscriptionOwnerRef(db, stripeId)
    if (!ref) continue
    transaction.set(ref, { stripeId, uid, updatedAt: timestamp }, { merge: true })
  }
}

function indexBillingResources(transaction, db, userRef, resources, timestamp) {
  for (const { type, stripeId } of resources) {
    const ref = billingResourceRef(userRef, type, stripeId)
    if (!ref) continue
    transaction.set(ref, { type, stripeId, updatedAt: timestamp }, { merge: true })
  }
  indexSubscriptionOwners(transaction, db, userRef.id, resources, timestamp)
}

async function queueBillingCleanup(transaction, tombstoneRef, resources, timestamp) {
  const entries = resources.map(({ type, stripeId, verified = true }) => ({
    ref: billingCleanupResourceRef(tombstoneRef, type, stripeId),
    stripeId,
    type,
    verified,
  })).filter(({ ref }) => ref)
  const [tombstoneSnapshot, ...snapshots] = await Promise.all([
    transaction.get(tombstoneRef),
    ...entries.map(({ ref }) => transaction.get(ref)),
  ])
  let queued = false
  for (const [index, { ref, type, stripeId, verified }] of entries.entries()) {
    const existing = snapshots[index].exists ? snapshots[index].data() : {}
    const reopenRejectedOwnership = existing.status === 'completed'
      && existing.ownershipRejected === true
      && verified === true
    const status = existing.status === 'completed' && !reopenRejectedOwnership
      ? 'completed'
      : 'pending'
    transaction.set(ref, {
      nextAttemptAt: status === 'pending' ? existing.nextAttemptAt || timestamp : null,
      ...(reopenRejectedOwnership ? { ownershipRejected: false, processingToken: null } : {}),
      type,
      stripeId,
      status,
      updatedAt: timestamp,
      verified: existing.verified === true || verified === true,
    }, { merge: true })
    queued ||= status === 'pending'
  }
  if (queued) {
    const tombstone = tombstoneSnapshot.exists ? tombstoneSnapshot.data() : {}
    const preserveFailureSchedule = Number.isSafeInteger(tombstone.cleanupAttemptCount)
      && tombstone.cleanupAttemptCount > 0
    transaction.set(tombstoneRef, {
      ...(preserveFailureSchedule ? {} : {
        cleanupAttemptCount: 0,
        cleanupLastError: null,
        cleanupNextAttemptAt: timestamp,
        cleanupUpdatedAt: timestamp,
      }),
      cleanupStatus: 'pending',
    }, { merge: true })
  }
}

function stripeSessionBelongsToUser(session, uid) {
  const clientUid = session?.client_reference_id
  const metadataUid = session?.metadata?.firebaseUid
  if (clientUid !== undefined && clientUid !== null && clientUid !== uid) return false
  if (metadataUid !== undefined && metadataUid !== null && metadataUid !== uid) return false
  return clientUid === uid || metadataUid === uid
}

async function listCustomerCheckoutSessions(stripe, customerId) {
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
  return sessions
}

async function customerBelongsToUser(stripe, customerId, uid) {
  const sessions = await listCustomerCheckoutSessions(stripe, customerId)
  return sessions.some(session => stripeSessionBelongsToUser(session, uid))
}

module.exports = {
  billingResourceRef,
  billingCleanupResourceRef,
  customerBelongsToUser,
  indexBillingResources,
  indexSubscriptionOwners,
  listCustomerCheckoutSessions,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
  subscriptionOwnerRef,
  validBillingResource,
}
