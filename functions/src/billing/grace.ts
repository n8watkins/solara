// The past_due grace period.
//
// When a renewal payment fails, Stripe marks the subscription `past_due` and retries the
// card for a while (Smart Retries). Pro stays on for PAST_DUE_GRACE_DAYS from the first
// failure, so a card that is updated, or a retry that succeeds, never costs anyone their
// plan; the account page asks them to update the payment method meanwhile. After the
// grace period the account is Free until a payment succeeds, whether or not Stripe has
// sent another event: the maintenance job ends grace periods that ran out.

import type { DocumentData, Firestore } from 'firebase-admin/firestore'

import { toMillis } from '../shared/time'

export const PAST_DUE_GRACE_DAYS = 7
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000
const GRACE_PAGE_SIZE = 50

/**
 * When a `past_due` subscription started being past due: the stored time if the
 * account was already past due, otherwise the event's.
 */
export function pastDueSince(userData: DocumentData, eventCreatedSeconds: number): Date {
  const stored = toMillis(userData.pastDueSince)
  return new Date(
    userData.subscriptionStatus === 'past_due' && Number.isFinite(stored)
      ? stored
      : eventCreatedSeconds * 1000,
  )
}

export function withinGrace(since: Date, now = Date.now()): boolean {
  return now - since.getTime() < PAST_DUE_GRACE_MS
}

/** Moves accounts whose grace period ran out to Free; returns how many changed. */
export async function endExpiredGracePeriods({
  db,
  now = new Date(),
}: {
  db: Firestore
  now?: Date
}): Promise<{ ended: number }> {
  const cutoff = new Date(now.getTime() - PAST_DUE_GRACE_MS)
  const expired = await db
    .collection('users')
    .where('subscriptionStatus', '==', 'past_due')
    .where('tier', '==', 'paid')
    .where('pastDueSince', '<=', cutoff)
    .limit(GRACE_PAGE_SIZE)
    .get()
  let ended = 0
  for (const doc of expired.docs) {
    const changed = await db.runTransaction(async transaction => {
      const current = (await transaction.get(doc.ref)).data()
      const since = toMillis(current?.pastDueSince)
      if (
        current?.subscriptionStatus !== 'past_due' ||
        current.tier !== 'paid' ||
        !Number.isFinite(since) ||
        since > cutoff.getTime()
      ) {
        return false
      }
      transaction.set(doc.ref, { tier: 'free', proSince: null, graceEndedAt: now }, { merge: true })
      return true
    })
    if (changed) ended += 1
  }
  return { ended }
}
