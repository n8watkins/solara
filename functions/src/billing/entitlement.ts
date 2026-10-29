// Who has Pro right now, decided on the server from the stored account.
//
// `tier: 'paid'` is the server-owned plan field the Stripe webhook writes, but a paid
// feature that acts on its own (the scheduled alerts) checks the subscription behind it
// too, so a stale `tier` between a Stripe event and the next maintenance run never
// gives anything away:
//
// - `active` or `trialing`: Pro.
// - `past_due`: Pro for PAST_DUE_GRACE_DAYS from the first failed renewal (grace.ts).
// - any other status (`canceled`, `unpaid`, `incomplete`, ...): not Pro.
// - no subscription at all: Pro granted by the owner by hand (`tier` set in the console).
// - an account being deleted: never.
//
// The statuses are Stripe's: `subscriptionProvider` names where the subscription was
// bought, and is read as Stripe when absent (every account so far). A provider this code
// does not know (a Play or App Store source not built yet) grants nothing until its own
// check is added here.

import { subscriptionProviderOf } from '#core'
import type { DocumentData } from 'firebase-admin/firestore'

import { toMillis } from '../shared/time'
import { withinGrace } from './grace'
import { ACTIVE_SUBSCRIPTION_STATUSES } from './ids'

export function hasProEntitlement(
  user: DocumentData | undefined,
  now: number = Date.now(),
): boolean {
  if (!user || user.tier !== 'paid' || user.accountDeletionStartedAt) return false
  if (subscriptionProviderOf(user) !== 'stripe') return false
  const status = user.subscriptionStatus
  if (status === undefined || status === null) return true
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true
  if (status === 'past_due') {
    const since = toMillis(user.pastDueSince)
    return Number.isFinite(since) && withinGrace(new Date(since), now)
  }
  return false
}
