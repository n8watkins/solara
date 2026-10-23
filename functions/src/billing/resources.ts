// The billing-resource index: which Stripe objects belong to which account.
//
// `users/{uid}/billingResources` lists every checkout session, customer and subscription
// an account owns, `stripeSubscriptionOwners/{sha256}` maps a subscription back to its
// account, and an account deletion queues each resource under its tombstone for cleanup.

import { createHash } from 'node:crypto'

import type {
  DocumentReference,
  FieldValue,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore'
import type Stripe from 'stripe'

export type BillingResourceType = 'checkoutSession' | 'customer' | 'subscription'

export interface BillingResource {
  type: BillingResourceType | string
  stripeId: string | null | undefined
  verified?: boolean
}

/** The ownership fields of a checkout session, read defensively. */
export interface SessionOwnership {
  client_reference_id?: string | null
  metadata?: Record<string, unknown> | null
}

const BILLING_RESOURCE_TYPES: ReadonlySet<unknown> = new Set([
  'checkoutSession',
  'customer',
  'subscription',
])

export function validBillingResource(type: unknown, stripeId: unknown): stripeId is string {
  return BILLING_RESOURCE_TYPES.has(type) && typeof stripeId === 'string' && stripeId.length > 0
}

export function billingResourceRef(
  userRef: DocumentReference,
  type: string,
  stripeId: string | null | undefined,
): DocumentReference | null {
  if (!validBillingResource(type, stripeId)) return null
  const digest = createHash('sha256').update(`${type}\0${stripeId}`).digest('base64url')
  return userRef.collection('billingResources').doc(`${type}_${digest}`)
}

export function billingCleanupResourceRef(
  tombstoneRef: DocumentReference,
  type: string,
  stripeId: string | null | undefined,
): DocumentReference | null {
  if (!validBillingResource(type, stripeId)) return null
  const digest = createHash('sha256').update(`${type}\0${stripeId}`).digest('base64url')
  return tombstoneRef.collection('billingCleanupResources').doc(`${type}_${digest}`)
}

export function subscriptionOwnerRef(
  db: Firestore,
  stripeId: string | null | undefined,
): DocumentReference | null {
  if (!validBillingResource('subscription', stripeId)) return null
  const digest = createHash('sha256').update(stripeId).digest('base64url')
  return db.collection('stripeSubscriptionOwners').doc(digest)
}

export function indexSubscriptionOwners(
  transaction: Transaction,
  db: Firestore,
  uid: string,
  resources: BillingResource[],
  timestamp: Date | FieldValue,
): void {
  for (const { type, stripeId, verified = true } of resources) {
    if (type !== 'subscription' || verified === false) continue
    const ref = subscriptionOwnerRef(db, stripeId)
    if (!ref) continue
    transaction.set(ref, { stripeId, uid, updatedAt: timestamp }, { merge: true })
  }
}

export function indexBillingResources(
  transaction: Transaction,
  db: Firestore,
  userRef: DocumentReference,
  resources: BillingResource[],
  timestamp: Date | FieldValue,
): void {
  for (const { type, stripeId } of resources) {
    const ref = billingResourceRef(userRef, type, stripeId)
    if (!ref) continue
    transaction.set(ref, { type, stripeId, updatedAt: timestamp }, { merge: true })
  }
  indexSubscriptionOwners(transaction, db, userRef.id, resources, timestamp)
}

export async function queueBillingCleanup(
  transaction: Transaction,
  tombstoneRef: DocumentReference,
  resources: BillingResource[],
  timestamp: Date | FieldValue,
): Promise<void> {
  const entries = resources.flatMap(({ type, stripeId, verified = true }) => {
    const ref = billingCleanupResourceRef(tombstoneRef, type, stripeId)
    return ref ? [{ ref, stripeId, type, verified }] : []
  })
  const [tombstoneSnapshot, ...snapshots] = await Promise.all([
    transaction.get(tombstoneRef),
    ...entries.map(({ ref }) => transaction.get(ref)),
  ])
  let queued = false
  for (const [index, { ref, type, stripeId, verified }] of entries.entries()) {
    const existing = snapshots[index]?.data() ?? {}
    const reopenRejectedOwnership =
      existing.status === 'completed' && existing.ownershipRejected === true && verified === true
    const status =
      existing.status === 'completed' && !reopenRejectedOwnership ? 'completed' : 'pending'
    transaction.set(
      ref,
      {
        nextAttemptAt: status === 'pending' ? existing.nextAttemptAt || timestamp : null,
        ...(reopenRejectedOwnership ? { ownershipRejected: false, processingToken: null } : {}),
        type,
        stripeId,
        status,
        updatedAt: timestamp,
        verified: existing.verified === true || verified === true,
      },
      { merge: true },
    )
    queued ||= status === 'pending'
  }
  if (queued) {
    const tombstone = tombstoneSnapshot?.data() ?? {}
    const preserveFailureSchedule =
      Number.isSafeInteger(tombstone.cleanupAttemptCount) && tombstone.cleanupAttemptCount > 0
    transaction.set(
      tombstoneRef,
      {
        ...(preserveFailureSchedule
          ? {}
          : {
              cleanupAttemptCount: 0,
              cleanupLastError: null,
              cleanupNextAttemptAt: timestamp,
              cleanupUpdatedAt: timestamp,
            }),
        cleanupStatus: 'pending',
      },
      { merge: true },
    )
  }
}

/**
 * Whether a checkout session was created for `uid`: its client reference or metadata names
 * the account, and neither names another one.
 */
export function stripeSessionBelongsToUser(
  session: SessionOwnership | null | undefined,
  uid: string,
): boolean {
  const clientUid = session?.client_reference_id
  const metadataUid = session?.metadata?.firebaseUid
  if (clientUid !== undefined && clientUid !== null && clientUid !== uid) return false
  if (metadataUid !== undefined && metadataUid !== null && metadataUid !== uid) return false
  return clientUid === uid || metadataUid === uid
}

export async function listCustomerCheckoutSessions(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Checkout.Session[]> {
  const sessions: Stripe.Checkout.Session[] = []
  let startingAfter: string | null | undefined
  do {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    sessions.push(...page.data)
    startingAfter = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !startingAfter)
      throw new Error('Stripe checkout pagination was incomplete')
  } while (startingAfter)
  return sessions
}

export async function customerBelongsToUser(
  stripe: Stripe,
  customerId: string,
  uid: string,
): Promise<boolean> {
  const sessions = await listCustomerCheckoutSessions(stripe, customerId)
  return sessions.some(session => stripeSessionBelongsToUser(session, uid))
}
