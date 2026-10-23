// One-time, resumable backfill of the billing-resource index from Stripe checkout sessions.

import type { Firestore } from 'firebase-admin/firestore'
import type Stripe from 'stripe'

import type { ServerTimestamp } from '../shared/time'
import { stringId, validUid } from './ids'
import {
  type BillingResource,
  indexBillingResources,
  indexSubscriptionOwners,
  queueBillingCleanup,
  stripeSessionBelongsToUser,
} from './resources'

export interface BackfillResult {
  completed: boolean
  processed: number
}

/**
 * Indexes one page of checkout sessions. The whole history is walked twice, so sessions
 * created during the first pass are indexed too; then the backfill marks itself complete.
 */
export async function backfillBillingResourcePage({
  db,
  serverTimestamp,
  stripe,
}: {
  db: Firestore
  serverTimestamp: ServerTimestamp
  stripe: Stripe
}): Promise<BackfillResult> {
  const stateRef = db.collection('systemMigrations').doc('stripeBillingResourceOwnersV1')
  const stateSnapshot = await stateRef.get()
  const state = stateSnapshot.data() ?? {}
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
    const resources: BillingResource[] = [
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
        userSnapshot.data()?.accountDeletionStartedAt
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
              ? tombstoneSnapshot.data()?.createdAt
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
