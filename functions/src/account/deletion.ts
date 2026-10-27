// Account deletion.
//
// Deleting an account writes a tombstone, revokes sessions, then cancels and cleans up
// every Stripe resource the account owns in small leased pages (a scheduled job resumes
// any page that fails), and only then deletes the account data and the Auth user.

import { randomUUID } from 'node:crypto'

import type { Auth } from 'firebase-admin/auth'
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { Request } from 'firebase-functions/v2/https'
import type Stripe from 'stripe'

import { TERMINAL_SUBSCRIPTION_STATUSES, stringId, stripePageCursor } from '../billing/ids'
import {
  type BillingResource,
  indexSubscriptionOwners,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
} from '../billing/resources'
import { deleteCalendarFeedsForUser } from '../feed/tokens'
import { authenticate, uidLimiter } from '../shared/auth'
import { HttpError, errorCode, errorMessage, loggableError } from '../shared/errors'
import { toMillis } from '../shared/time'

const BILLING_INDEX_PAGE_SIZE = 25
const BILLING_CLEANUP_PAGE_SIZE = 10
const BILLING_CLEANUP_LEASE_MS = 5 * 60 * 1000
const BILLING_CLEANUP_RETRY_BASE_MS = 5 * 60 * 1000
const BILLING_CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1000
const deletionLimiter = uidLimiter(3)

/** A cleanup resource claimed under a processing lease. */
interface ClaimedResource {
  id: string
  ref: DocumentReference
  data: () => DocumentData
}

interface CleanupContext {
  db: Firestore
  resource: ClaimedResource
  stripe: Stripe
  tombstoneRef: DocumentReference
  uid: string
}

export interface DeletionPageResult {
  completed: boolean
  processed: number
}

function cleanupRetryDelay(attemptCount: number): number {
  return Math.min(
    BILLING_CLEANUP_RETRY_BASE_MS * 2 ** Math.min(attemptCount - 1, 30),
    BILLING_CLEANUP_RETRY_MAX_MS,
  )
}

async function ensureSessionsRevoked(
  auth: Auth,
  db: Firestore,
  tombstoneRef: DocumentReference,
  tombstone: DocumentData,
  uid: string,
): Promise<void> {
  if (tombstone.sessionsRevokedAt) return
  await auth.revokeRefreshTokens(uid)
  await db.runTransaction(async transaction => {
    const current = await transaction.get(tombstoneRef)
    if (!current.exists || current.data()?.cleanupStatus !== 'pending') return
    if (!current.data()?.sessionsRevokedAt) {
      transaction.set(tombstoneRef, { sessionsRevokedAt: new Date() }, { merge: true })
    }
  })
}

async function markCleanupResource(
  db: Firestore,
  resource: ClaimedResource,
  data: DocumentData,
): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(resource.ref)
    if (
      !current.exists ||
      current.data()?.status !== 'pending' ||
      current.data()?.processingToken !== resource.data()?.processingToken
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

async function markCleanupFailure(
  db: Firestore,
  resource: ClaimedResource,
  error: unknown,
): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(resource.ref)
    if (
      !current.exists ||
      current.data()?.status !== 'pending' ||
      current.data()?.processingToken !== resource.data()?.processingToken
    ) {
      return false
    }
    const timestamp = new Date()
    const attemptCount = Number.isSafeInteger(current.data()?.attemptCount)
      ? current.data()?.attemptCount + 1
      : 1
    const delay = cleanupRetryDelay(attemptCount)
    transaction.set(
      resource.ref,
      {
        attemptCount,
        lastError: errorMessage(error, 'Billing cleanup failed'),
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

async function markAccountCleanupFailure(
  db: Firestore,
  tombstoneRef: DocumentReference,
  error: unknown,
): Promise<boolean> {
  return db.runTransaction(async transaction => {
    const current = await transaction.get(tombstoneRef)
    if (!current.exists || current.data()?.cleanupStatus !== 'pending') return false
    const timestamp = new Date()
    const attemptCount = Number.isSafeInteger(current.data()?.cleanupAttemptCount)
      ? current.data()?.cleanupAttemptCount + 1
      : 1
    const nextAttemptAt = new Date(timestamp.getTime() + cleanupRetryDelay(attemptCount))
    transaction.set(
      tombstoneRef,
      {
        cleanupAttemptCount: attemptCount,
        cleanupLastError: errorMessage(error, 'Account deletion cleanup failed'),
        cleanupLastFailedAt: timestamp,
        cleanupNextAttemptAt: nextAttemptAt,
        cleanupUpdatedAt: nextAttemptAt,
      },
      { merge: true },
    )
    return true
  })
}

async function claimCleanupResources(
  db: Firestore,
  tombstoneRef: DocumentReference,
): Promise<ClaimedResource[]> {
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

async function queueDiscoveredResources(
  db: Firestore,
  tombstoneRef: DocumentReference,
  uid: string,
  resources: BillingResource[],
): Promise<void> {
  await db.runTransaction(async transaction => {
    const timestamp = new Date()
    await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
    indexSubscriptionOwners(transaction, db, uid, resources, timestamp)
  })
}

async function processCheckoutCleanup({
  db,
  resource,
  stripe,
  tombstoneRef,
  uid,
}: CleanupContext): Promise<void> {
  const data = resource.data()
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(data.stripeId)
  } catch (error) {
    if (errorCode(error) === 'resource_missing') {
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

async function processSubscriptionCleanup({
  db,
  resource,
  stripe,
  uid,
}: CleanupContext): Promise<void> {
  const data = resource.data()
  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(data.stripeId)
  } catch (error) {
    if (errorCode(error) === 'resource_missing') {
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
      if (errorCode(error) !== 'resource_missing') throw error
    }
  }
  await markCleanupResource(db, resource, { status: 'completed', verified: true })
}

async function processCustomerCleanup({
  db,
  resource,
  stripe,
  tombstoneRef,
  uid,
}: CleanupContext): Promise<void> {
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

async function finalizeAccountDeletion({
  auth,
  db,
  tombstoneRef,
  uid,
  userRef,
}: {
  auth: Auth
  db: Firestore
  tombstoneRef: DocumentReference
  uid: string
  userRef: DocumentReference
}): Promise<boolean> {
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
    const tombstone = tombstoneSnapshot.data() ?? {}
    const leaseExpiresAt: unknown =
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
  await deleteCalendarFeedsForUser(db, uid)
  await db.recursiveDelete(userRef)
  try {
    await auth.deleteUser(uid)
  } catch (error) {
    if (errorCode(error) !== 'auth/user-not-found') throw error
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

export async function processAccountDeletionPage({
  auth,
  db,
  stripe,
  tombstoneRef,
  uid,
}: {
  auth: Auth
  db: Firestore
  stripe: Stripe
  tombstoneRef: DocumentReference
  uid: string
}): Promise<DeletionPageResult> {
  const userRef = db.collection('users').doc(uid)
  const tombstoneSnapshot = await tombstoneRef.get()
  if (!tombstoneSnapshot.exists || tombstoneSnapshot.data()?.cleanupStatus !== 'pending') {
    return { completed: tombstoneSnapshot.data()?.cleanupStatus === 'completed', processed: 0 }
  }
  const tombstone = tombstoneSnapshot.data() ?? {}
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
      const currentData = current.data() ?? {}
      if (
        currentData.cleanupStatus !== 'pending' ||
        currentData.resourceIndexComplete === true ||
        currentData.resourceIndexCursor !== tombstone.resourceIndexCursor
      ) {
        return false
      }
      const resources: BillingResource[] = page.docs.map(doc => ({
        ...(doc.data() as BillingResource),
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
      const context: CleanupContext = { db, resource, stripe, tombstoneRef, uid }
      if (resource.data()?.type === 'checkoutSession') await processCheckoutCleanup(context)
      if (resource.data()?.type === 'customer') await processCustomerCleanup(context)
      if (resource.data()?.type === 'subscription') await processSubscriptionCleanup(context)
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

/** Resumes up to 10 pending deletions that are due; throws if any of them failed. */
export async function processPendingAccountDeletions({
  auth,
  db,
  stripe,
  now = new Date(),
}: {
  auth: Auth
  db: Firestore
  stripe: Stripe
  now?: Date
}): Promise<DeletionPageResult[]> {
  const tombstones = await db
    .collection('accountDeletionTombstones')
    .where('cleanupStatus', '==', 'pending')
    .orderBy('cleanupUpdatedAt')
    .limit(10)
    .get()
  const results: DeletionPageResult[] = []
  const failures: Error[] = []
  for (const tombstone of tombstones.docs) {
    const nextAttemptAt = tombstone.data?.().cleanupNextAttemptAt
    const nextAttemptAtMs = toMillis(nextAttemptAt)
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

export async function deleteAccount({
  auth,
  db,
  req,
  stripe,
}: {
  auth: Auth
  db: Firestore
  req: Request
  stripe: Stripe
}): Promise<DeletionPageResult> {
  const identity = await authenticate(auth, req.headers.authorization, {
    maxAgeSeconds: 300,
    limiter: deletionLimiter,
  })
  if (req.body?.confirmation !== 'DELETE') {
    throw new HttpError('invalid-argument', 'Type DELETE to confirm')
  }
  const userRef = db.collection('users').doc(identity.uid)
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(identity.uid)
  await db.runTransaction(async transaction => {
    const [userSnapshot, tombstoneSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(tombstoneRef),
    ])
    const timestamp = new Date()
    const userData = userSnapshot.data() ?? {}
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
        createdAt: tombstoneSnapshot.exists ? tombstoneSnapshot.data()?.createdAt : timestamp,
        resourceIndexComplete: tombstoneSnapshot.exists
          ? tombstoneSnapshot.data()?.resourceIndexComplete === true
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
    // The tombstone is written, so the scheduled cleanup resumes from here.
    logger.warn('deleteAccount cleanup deferred to the scheduled job', {
      uid: identity.uid,
      error: loggableError(error),
    })
    await markAccountCleanupFailure(db, tombstoneRef, error).catch(() => false)
    return { completed: false, processed: 0 }
  }
}
