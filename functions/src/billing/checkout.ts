// Checkout and billing-portal sessions, and the cleanup of checkouts that failed halfway.

import { createHash, randomUUID } from 'node:crypto'

import type { Auth } from 'firebase-admin/auth'
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'
import type Stripe from 'stripe'

import { authenticate, uidLimiter } from '../shared/auth'
import { HttpError, errorCode, errorMessage } from '../shared/errors'
import { toMillis } from '../shared/time'
import {
  TERMINAL_SUBSCRIPTION_STATUSES,
  listCustomerSubscriptions,
  stringId,
  validAttemptId,
  validUid,
} from './ids'
import {
  type BillingResource,
  billingResourceRef,
  customerBelongsToUser,
  indexBillingResources,
  indexSubscriptionOwners,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
} from './resources'

const CHECKOUT_RESERVATION_MS = 24 * 60 * 60 * 1000
const CHECKOUT_CLEANUP_LEASE_MS = 5 * 60 * 1000
const CHECKOUT_CLEANUP_LIMIT = 10
const CHECKOUT_CLEANUP_MAX_RETRY_MS = 24 * 60 * 60 * 1000
/** Per-account budgets: a person opens checkout or the portal a few times at most. */
const checkoutLimiter = uidLimiter(5)
const portalLimiter = uidLimiter(5)

/** Makes a checkout session unable to charge: expire it, or cancel what it created. */
export async function neutralizeCheckoutSession(stripe: Stripe, sessionId: string): Promise<void> {
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    if (errorCode(error) === 'resource_missing') return
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
      if (errorCode(error) !== 'resource_missing') throw error
    }
    return
  }
  throw new Error('Checkout session has an unexpected status')
}

function checkoutCleanupTaskRef(db: Firestore, sessionId: string) {
  const digest = createHash('sha256').update(sessionId).digest('base64url')
  return db.collection('stripeCheckoutCleanupTasks').doc(digest)
}

async function queueCheckoutCleanup(db: Firestore, sessionId: string, uid: string): Promise<void> {
  const taskRef = checkoutCleanupTaskRef(db, sessionId)
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(taskRef)
    if (snapshot.exists && ['completed', 'pending'].includes(snapshot.data()?.status)) return
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

function checkoutCleanupRetryDelay(attemptCount: number): number {
  return Math.min(
    60_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 10),
    CHECKOUT_CLEANUP_MAX_RETRY_MS,
  )
}

export interface CheckoutCleanupResult {
  id: string
  completed: boolean
}

export async function processPendingCheckoutCleanups({
  db,
  stripe,
  now = new Date(),
}: {
  db: Firestore
  stripe: Stripe
  now?: Date
}): Promise<CheckoutCleanupResult[]> {
  const tasks = await db
    .collection('stripeCheckoutCleanupTasks')
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt')
    .limit(CHECKOUT_CLEANUP_LIMIT)
    .get()
  const results: CheckoutCleanupResult[] = []
  for (const task of tasks.docs) {
    const processingToken = randomUUID()
    const claimed = await db.runTransaction(async transaction => {
      const current = await transaction.get(task.ref)
      if (!current.exists || current.data()?.status !== 'pending') return null
      const nextAttemptAt = toMillis(current.data()?.nextAttemptAt)
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
        if (!current.exists || current.data()?.processingToken !== processingToken) return
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
        if (!current.exists || current.data()?.processingToken !== processingToken) return
        const attemptCount = Number.isSafeInteger(current.data()?.attemptCount)
          ? current.data()?.attemptCount + 1
          : 1
        const timestamp = new Date()
        transaction.set(
          task.ref,
          {
            attemptCount,
            lastError: errorMessage(error, 'Checkout cleanup failed'),
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

type Reservation =
  | { reuseSessionId: string; userData?: undefined }
  | { reuseSessionId?: undefined; userData: DocumentData }

export async function createCheckout({
  appUrl,
  auth,
  db,
  expectedPriceId,
  req,
  stripe,
}: {
  appUrl: string
  auth: Auth
  db: Firestore
  expectedPriceId: string
  req: Request
  stripe: Stripe
}): Promise<Stripe.Checkout.Session> {
  if (!expectedPriceId) throw new Error('STRIPE_PRICE_ID is not configured')
  const identity = await authenticate(auth, req.headers.authorization, {
    limiter: checkoutLimiter,
  })
  if (!validUid(identity.uid)) {
    throw new HttpError('unauthenticated', 'Invalid account')
  }
  const attemptId: unknown = req.body?.attemptId
  if (!validAttemptId(attemptId)) {
    throw new HttpError('invalid-argument', 'Invalid checkout attempt')
  }

  const userRef = db.collection('users').doc(identity.uid)
  const now = Date.now()
  const reserveCheckout = (expiredSessionId?: string) =>
    db.runTransaction(async (transaction): Promise<Reservation> => {
      const snapshot = await transaction.get(userRef)
      if (!snapshot.exists) {
        throw new HttpError('not-found', 'Account does not exist')
      }
      const current = snapshot.data() ?? {}
      if (current.accountDeletionStartedAt) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
      }
      if (
        current.stripeSubscriptionId &&
        !TERMINAL_SUBSCRIPTION_STATUSES.has(current.subscriptionStatus)
      ) {
        throw new HttpError('conflict', 'Account already has a subscription')
      }
      const reservedBy = current.stripeCheckoutAttemptId
      const reservedUntil = toMillis(current.stripeCheckoutReservedUntil)
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
        throw new HttpError('conflict', 'Checkout is already in progress')
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
    let existing: Stripe.Checkout.Session | undefined
    try {
      existing = await stripe.checkout.sessions.retrieve(reservation.reuseSessionId)
    } catch (error) {
      if (errorCode(error) !== 'resource_missing') throw error
    }
    if (existing && stripeSessionBelongsToUser(existing, identity.uid)) {
      if (existing.status === 'open' && existing.url) return existing
      if (existing.status === 'complete') {
        throw new HttpError('conflict', 'Checkout payment is being processed')
      }
    }
    reservation = await reserveCheckout(reservation.reuseSessionId)
  }
  const userData = reservation.userData ?? {}

  const releaseReservation = async () =>
    db.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef)
      if (!snapshot.exists || snapshot.data()?.stripeCheckoutAttemptId !== attemptId) return
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

  const existingCustomerId: string | null =
    typeof userData.stripeCustomerId === 'string' && userData.stripeCustomerId
      ? userData.stripeCustomerId
      : null
  const customer = existingCustomerId
    ? { customer: existingCustomerId }
    : { customer_email: identity.email }
  let createdSessionId: string | null = null
  let cleanupQueued = false
  try {
    if (existingCustomerId) {
      const customerRef = billingResourceRef(userRef, 'customer', existingCustomerId)
      if (!customerRef) throw new Error('Invalid billing customer identifier')
      const indexedCustomer = await customerRef.get()
      if (
        !indexedCustomer.exists &&
        !(await customerBelongsToUser(stripe, existingCustomerId, identity.uid))
      ) {
        throw new HttpError('conflict', 'Billing account ownership could not be verified')
      }
      const subscriptions = await listCustomerSubscriptions(stripe, existingCustomerId)
      if (
        subscriptions.some(subscription => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status))
      ) {
        throw new HttpError('conflict', 'Account already has a subscription')
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
        success_url: `${appUrl}/app/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/app/?checkout=canceled`,
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
        !snapshot.exists || tombstone.exists || snapshot.data()?.accountDeletionStartedAt
      if (deletionStarted) {
        const resources: BillingResource[] = [
          { type: 'checkoutSession', stripeId: session.id },
          { type: 'customer', stripeId: stringId(session.customer) || existingCustomerId },
          { type: 'subscription', stripeId: stringId(session.subscription) },
        ]
        const timestamp = new Date()
        await queueBillingCleanup(transaction, tombstoneRef, resources, timestamp)
        indexSubscriptionOwners(transaction, db, identity.uid, resources, timestamp)
        return { deletionStarted: true, persisted: false }
      }
      if (snapshot.data()?.stripeCheckoutAttemptId !== attemptId) {
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
          { type: 'customer', stripeId: stringId(session.customer) || existingCustomerId },
        ],
        new Date(),
      )
      return { deletionStarted: false, persisted: true }
    })
    cleanupQueued = persistence.deletionStarted
    if (!persistence.persisted) {
      throw persistence.deletionStarted
        ? new HttpError('deletion-in-progress', 'Account deletion is in progress')
        : new HttpError('conflict', 'Checkout reservation changed')
    }
    return session
  } catch (error) {
    let failure: unknown = error
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

export async function createBillingPortal({
  appUrl,
  auth,
  db,
  req,
  stripe,
}: {
  appUrl: string
  auth: Auth
  db: Firestore
  req: Request
  stripe: Stripe
}): Promise<Stripe.BillingPortal.Session> {
  const identity = await authenticate(auth, req.headers.authorization, {
    limiter: portalLimiter,
  })
  if (!validUid(identity.uid)) {
    throw new HttpError('unauthenticated', 'Invalid account')
  }
  const userRef = db.collection('users').doc(identity.uid)
  const userSnapshot = await userRef.get()
  const customerId: unknown = userSnapshot.exists ? userSnapshot.data()?.stripeCustomerId : null
  if (typeof customerId !== 'string' || !customerId) {
    throw new HttpError('not-found', 'No billing account exists')
  }
  if (userSnapshot.data()?.accountDeletionStartedAt) {
    throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
  }
  const customerRef = billingResourceRef(userRef, 'customer', customerId)
  if (!customerRef) throw new Error('Invalid billing customer identifier')
  const indexedCustomer = await customerRef.get()
  if (!indexedCustomer.exists) {
    const owned = await customerBelongsToUser(stripe, customerId, identity.uid)
    if (!owned) {
      throw new HttpError('not-found', 'No verified billing account exists')
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
        currentUser.data()?.accountDeletionStartedAt ||
        currentUser.data()?.stripeCustomerId !== customerId
      ) {
        throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
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
