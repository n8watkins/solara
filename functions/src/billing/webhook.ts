// Stripe webhook processing: verified checkout and subscription events update the account's
// tier exactly once per event, and subscriptions that cannot be applied are canceled.

import type { Auth } from 'firebase-admin/auth'
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type Stripe from 'stripe'

import { errorCode } from '../shared/errors'
import type { ServerTimestamp } from '../shared/time'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  stringId,
  validUid,
} from './ids'
import { pastDueSince, withinGrace } from './grace'
import { cancelAndRefund, endSubscriptionForReversedPayment } from './refunds'
import { type TrialHistory, type TrialKey, identityFromUser } from './trial-history'
import {
  type BillingResource,
  customerBelongsToUser,
  indexBillingResources,
  subscriptionOwnerRef,
} from './resources'

const EVENT_PRIORITY: Record<string, number> = {
  'checkout.session.completed': 0,
  'checkout.session.async_payment_failed': 1,
  'checkout.session.async_payment_succeeded': 2,
  'customer.subscription.updated': 3,
  'customer.subscription.deleted': 4,
}

/** The subscription fields this module reads, so tests can pass partial objects. */
type SubscriptionLike = Pick<Stripe.Subscription, 'id' | 'customer' | 'status' | 'metadata'> & {
  items?: {
    data?: Array<{ price?: unknown; current_period_end?: unknown } | null | undefined>
  } | null
  trial_start?: number | null
  trial_end?: number | null
  cancel_at_period_end?: boolean | null
  default_payment_method?: unknown
}

/** Whether the subscription is for one of the Pro prices. */
export function subscriptionHasPrice(
  subscription: SubscriptionLike | null | undefined,
  priceIds: readonly string[],
): boolean {
  const items = subscription?.items?.data
  return (
    Array.isArray(items) &&
    items.some(item => {
      const price = stringId(item?.price)
      return !!price && priceIds.includes(price)
    })
  )
}

function epochSecondsToDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000)
    : null
}

/**
 * The subscription facts the account page shows and the export includes, without any
 * Stripe identifier: the plan, when the current period or the trial ends, and whether
 * it is set to end. `stripeTrialUsed` makes the trial once per account.
 */
export function billingSummaryFields(
  subscription: SubscriptionLike,
  prices: { monthly: string; yearly: string },
): DocumentData {
  const priceIds = (subscription.items?.data ?? []).map(item => stringId(item?.price))
  const plan = priceIds.includes(prices.yearly)
    ? 'yearly'
    : priceIds.includes(prices.monthly)
      ? 'monthly'
      : null
  const periodEnds = (subscription.items?.data ?? [])
    .map(item => epochSecondsToDate(item?.current_period_end))
    .filter((date): date is Date => date !== null)
  return {
    subscriptionPlan: plan,
    subscriptionCurrentPeriodEnd: periodEnds.length
      ? new Date(Math.max(...periodEnds.map(date => date.getTime())))
      : null,
    subscriptionTrialEnd: epochSecondsToDate(subscription.trial_end),
    subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    ...(subscription.trial_start ? { stripeTrialUsed: true } : {}),
  }
}

export async function validateCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  priceIds: readonly string[],
  { requirePaid = true }: { requirePaid?: boolean } = {},
): Promise<{ uid: string; customerId: string; subscriptionId: string; paid: boolean }> {
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
  if (priceIds.length === 0) throw new Error('STRIPE_PRICE_ID is not configured')

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 })
  if (
    !lineItems.data.some(item => {
      const price = stringId(item.price)
      return !!price && priceIds.includes(price)
    })
  ) {
    throw new Error('Checkout session does not contain the configured price')
  }

  const customerId = stringId(session.customer)
  const subscriptionId = stringId(session.subscription)
  if (!customerId || !subscriptionId)
    throw new Error('Checkout session is missing subscription data')
  return { uid, customerId, subscriptionId, paid }
}

/** The distinct user documents that own billing-resource index entries of `type`. */
function indexedUserRefs(
  docs: QueryDocumentSnapshot[],
  type: string,
): Map<string, DocumentReference> {
  const owners = new Map<string, DocumentReference>()
  for (const doc of docs) {
    const userRef = doc.ref.parent.parent
    if (doc.data()?.type === type && userRef) owners.set(userRef.id, userRef)
  }
  return owners
}

export async function findUserBySubscription(
  db: Firestore,
  stripe: Stripe,
  subscription: SubscriptionLike,
): Promise<DocumentSnapshot | null> {
  const subscriptionId = stringId(subscription?.id)
  const customerId = stringId(subscription?.customer)
  const metadataUid = subscription?.metadata?.firebaseUid
  if (metadataUid !== undefined && !validUid(metadataUid)) return null

  const ownerRef = subscriptionOwnerRef(db, subscriptionId)
  const ownerSnapshot = ownerRef ? await ownerRef.get() : null
  const owner = ownerSnapshot?.exists ? ownerSnapshot.data() : null
  const ownerUidCandidate = owner?.uid
  const ownerUid =
    owner?.stripeId === subscriptionId && validUid(ownerUidCandidate) ? ownerUidCandidate : null
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
    const indexedOwners = indexedUserRefs(indexed.docs, 'subscription')
    if (indexedOwners.size > 1) return null
    const indexedOwner = indexedOwners.values().next().value
    if (indexedOwner) {
      const user = await indexedOwner.get()
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
    if (bySubscription.docs.length === 1) return bySubscription.docs[0] ?? null
  }
  if (customerId) {
    const indexed = await db
      .collectionGroup('billingResources')
      .where('stripeId', '==', customerId)
      .limit(2)
      .get()
    const indexedOwners = indexedUserRefs(indexed.docs, 'customer')
    if (indexedOwners.size > 1) return null
    const candidateRef = indexedOwners.values().next().value
    if (candidateRef) {
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
      if (candidate && (await customerBelongsToUser(stripe, customerId, candidate.ref.id))) {
        return candidate
      }
    }
  }
  return null
}

async function findTombstonedUserRef(
  db: Firestore,
  subscription: SubscriptionLike,
): Promise<DocumentReference | null> {
  const subscriptionId = stringId(subscription?.id)
  const ownerRef = subscriptionOwnerRef(db, subscriptionId)
  const ownerSnapshot = ownerRef ? await ownerRef.get() : null
  const owner = ownerSnapshot?.exists ? ownerSnapshot.data() : null
  const ownerUid = owner?.uid
  const uid =
    owner?.stripeId === subscriptionId && validUid(ownerUid)
      ? ownerUid
      : subscription?.metadata?.firebaseUid
  if (!validUid(uid)) return null
  const tombstone = await db.collection('accountDeletionTombstones').doc(uid).get()
  return tombstone.exists ? db.collection('users').doc(uid) : null
}

function eventIsNewer(event: Stripe.Event, userData: DocumentData | undefined): boolean {
  const previousCreated = userData?.stripeEventCreated
  if (!Number.isFinite(previousCreated)) return true
  if (event.created !== previousCreated) return event.created > previousCreated
  return (EVENT_PRIORITY[event.type] ?? -1) >= (userData?.stripeEventPriority ?? -1)
}

export interface CommitResult {
  duplicate: boolean
  applied: boolean
  accountDeleted: boolean
  rejected: boolean
  cancellationPending: boolean
  cancellationSubscriptionId: string | null
}

async function commitEvent(
  db: Firestore,
  event: Stripe.Event,
  userRef: DocumentReference | null,
  buildUserData: ((userData: DocumentData) => DocumentData | null) | null,
  serverTimestamp: ServerTimestamp,
  cancellationSubscriptionId: string | null = null,
  billingResources: BillingResource[] = [],
): Promise<CommitResult> {
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  return db.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    const duplicate = eventSnapshot.exists
    const eventData = duplicate ? eventSnapshot.data() : null
    let applied = false
    let accountDeleted = false
    let rejected = false
    let cancellationPending = false
    let pendingCancellationSubscriptionId: string | null = null
    if (userRef && buildUserData) {
      const tombstoneRef = db.collection('accountDeletionTombstones').doc(userRef.id)
      const [userSnapshot, tombstoneSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tombstoneRef),
      ])
      accountDeleted =
        tombstoneSnapshot.exists ||
        !userSnapshot.exists ||
        !!userSnapshot.data()?.accountDeletionStartedAt
      if (!accountDeleted) {
        const userData = buildUserData(userSnapshot.data() ?? {})
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
        expireAt: expiresAfter(RETENTION_DAYS.stripeWebhookEvents),
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

async function completePendingCancellation({
  db,
  event,
  result,
  serverTimestamp,
  stripe,
}: {
  db: Firestore
  event: Stripe.Event
  result: CommitResult
  serverTimestamp: ServerTimestamp
  stripe: Stripe
}): Promise<void> {
  if (!result.cancellationPending || !result.cancellationSubscriptionId) return
  const eventRef = db.collection('stripeWebhookEvents').doc(event.id)
  // The customer did not mean to keep this subscription, so it is refunded in full
  // (billing/refunds.ts). A failure throws, and Stripe's retry repeats both steps safely.
  const { refunded } = await cancelAndRefund(
    stripe,
    result.cancellationSubscriptionId,
    result.accountDeleted ? 'account-deleted' : 'duplicate-checkout',
  )
  await eventRef.set(
    {
      cancellationStatus: 'completed',
      cancellationCompletedAt: serverTimestamp(),
      cancellationRefunds: refunded,
    },
    { merge: true },
  )
}

/**
 * Keeps the free trial once per person (trial-history.ts): records the trial under the
 * account's sign-in identities, verified email and card, and ends it at once (billing
 * starts now) when any of them already had a trial. Returns whether it ended the trial.
 * Throwing makes Stripe retry the event; the record and the update are idempotent.
 */
export async function enforceTrialOnce({
  auth,
  stripe,
  subscription,
  trialHistory,
  uid,
}: {
  auth: Pick<Auth, 'getUser'>
  stripe: Stripe
  subscription: SubscriptionLike
  trialHistory: TrialHistory | null
  uid: string
}): Promise<boolean> {
  if (!trialHistory || subscription.status !== 'trialing' || !subscription.trial_start) {
    return false
  }
  const keys: TrialKey[] = []
  try {
    keys.push(...trialHistory.identityKeys(identityFromUser(await auth.getUser(uid))))
  } catch (error) {
    // A deleted sign-in has nothing left to key on; anything else is retried.
    if (errorCode(error) !== 'auth/user-not-found') throw error
  }
  const paymentMethodId = stringId(subscription.default_payment_method)
  if (paymentMethodId) {
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const fingerprint = paymentMethod.card?.fingerprint
    if (fingerprint) keys.push(trialHistory.cardKey(fingerprint))
  }
  const { reused } = await trialHistory.record(keys, subscription.id)
  if (!reused) return false
  await stripe.subscriptions.update(
    subscription.id,
    { trial_end: 'now', proration_behavior: 'none' },
    { idempotencyKey: `trial-reuse:${subscription.id}` },
  )
  logger.info('a free trial already used by this person or card was ended', {
    subscriptionId: subscription.id,
  })
  return true
}

export type StripeEventResult =
  | CommitResult
  | (CommitResult & { trialEnded: boolean })
  | (CommitResult & { endedSubscriptionId: string | null })
  | { ignored: true }

/** Applies one signature-verified Stripe event. Throwing makes Stripe retry it. */
export async function processStripeEvent({
  auth,
  db,
  event,
  prices,
  serverTimestamp,
  stripe,
  trialHistory,
}: {
  /** Reads the account's sign-in identities for the trial history. */
  auth: Pick<Auth, 'getUser'>
  db: Firestore
  event: Stripe.Event
  /** The Pro price of each plan; a subscription to either is Pro. */
  prices: { monthly: string; yearly: string }
  serverTimestamp: ServerTimestamp
  stripe: Stripe
  /** The once-per-person trial record; null only in tests that do not cover it. */
  trialHistory: TrialHistory | null
}): Promise<StripeEventResult> {
  const priceIds = [prices.monthly, prices.yearly].filter(Boolean)
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
      priceIds,
      { requirePaid },
    )
    const userRef = db.collection('users').doc(uid)
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const active =
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) &&
      subscriptionHasPrice(subscription, priceIds)
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
          pastDueSince: null,
          ...billingSummaryFields(subscription, prices),
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
    const trialEnded =
      !result.accountDeleted &&
      !result.rejected &&
      (await enforceTrialOnce({ auth, stripe, subscription, trialHistory, uid }))
    return { ...result, trialEnded }
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
    const live = event.type !== 'customer.subscription.deleted'
    const proPrice = subscriptionHasPrice(currentSubscription, priceIds)
    const active = live && ACTIVE_SUBSCRIPTION_STATUSES.has(currentSubscription.status) && proPrice
    // A failed renewal keeps Pro for the grace period (billing/grace.ts).
    const pastDue = live && currentSubscription.status === 'past_due' && proPrice
    const checkoutStatus = active
      ? 'succeeded'
      : TERMINAL_SUBSCRIPTION_STATUSES.has(currentSubscription.status) ||
          currentSubscription.status === 'unpaid'
        ? 'failed'
        : null
    const update: DocumentData = {
      stripeCustomerId: stringId(currentSubscription.customer),
      stripeSubscriptionId: stringId(currentSubscription.id),
      subscriptionStatus:
        event.type === 'customer.subscription.deleted' ? 'canceled' : currentSubscription.status,
      subscriptionUpdatedAt: serverTimestamp(),
      ...billingSummaryFields(currentSubscription, prices),
    }
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
        // A different subscription replaces the stored one only when the stored one has ended
        // and this one has not, as in the checkout branch: Stripe does not order events, so a
        // returning subscriber's new subscription can report here before its checkout event.
        // An older subscription that has also ended never replaces the stored one.
        if (
          currentSubscriptionId &&
          currentSubscriptionId !== stringId(subscription.id) &&
          (!TERMINAL_SUBSCRIPTION_STATUSES.has(userData.subscriptionStatus) ||
            TERMINAL_SUBSCRIPTION_STATUSES.has(currentSubscription.status) ||
            event.type === 'customer.subscription.deleted')
        )
          return null
        const since = pastDue ? pastDueSince(userData, event.created) : null
        const pro = active || (since !== null && withinGrace(since))
        return {
          ...update,
          tier: pro ? 'paid' : 'free',
          pastDueSince: since,
          ...(pro ? {} : { proSince: null }),
          ...(checkoutStatus ? { stripeCheckoutStatus: checkoutStatus } : {}),
        }
      },
      serverTimestamp,
      cancellationSubscriptionId,
      [
        { type: 'customer', stripeId: stringId(currentSubscription.customer) },
        { type: 'subscription', stripeId: stringId(currentSubscription.id) },
      ],
    )
    await completePendingCancellation({ db, event, result, serverTimestamp, stripe })
    const trialEnded =
      !result.accountDeleted &&
      !result.rejected &&
      (await enforceTrialOnce({
        auth,
        stripe,
        subscription: currentSubscription,
        trialHistory,
        uid: userRef.id,
      }))
    return { ...result, trialEnded }
  }

  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    // A full refund or a dispute ends the subscription it paid for; the
    // customer.subscription.deleted event that follows takes Pro away.
    const endedSubscriptionId = await endSubscriptionForReversedPayment(stripe, event)
    const result = await commitEvent(db, event, null, null, serverTimestamp)
    return { ...result, endedSubscriptionId }
  }

  return { ignored: true }
}
