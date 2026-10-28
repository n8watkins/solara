// Claim before fetch (REVIEW5 H1): a scheduled document is claimed in the transaction
// that decides to work on it, before anything slow starts, by moving its `due` forward
// to when the next attempt may run if this one never reports back, and stamping
// `claimedAt`. The attempt's result then sets the real `due` and releases the claim.
//
// So an attempt that hangs or crashes its instance cannot pin a document at the head of
// a queue ordered by `due`: the document waits for its retry time like a failed one, and
// the next attempt that finds the claim older than its hold time knows the previous
// attempt was abandoned and can count it as a failure (so a document that crashes every
// time backs off and pauses like one that fails). A claim younger than the hold time
// belongs to an attempt still running, so a second one stays away.
//
// The fields are plain, so any job with a `due` queue can use them (linked calendars in
// subscriptions.ts; anything else that fetches on a schedule).

import { type DocumentData, FieldValue } from 'firebase-admin/firestore'

import { toMillis } from '../shared/time'

/** The field that holds when a running attempt claimed a document. */
export const CLAIM_FIELD = 'claimedAt'

/**
 * `free`: no attempt holds the document. `held`: an attempt claimed it less than `holdMs`
 * ago and may still be running. `abandoned`: the last attempt claimed it longer ago than
 * any attempt may run, and never reported back (it hung or its instance crashed).
 */
export type ClaimState = 'free' | 'held' | 'abandoned'

/** PURE. The state of a document's claim at `nowMs`. */
export function claimState(
  data: DocumentData | undefined,
  nowMs: number,
  holdMs: number,
): ClaimState {
  const claimedAt = toMillis(data?.[CLAIM_FIELD])
  if (!Number.isFinite(claimedAt)) return 'free'
  return nowMs - claimedAt < holdMs ? 'held' : 'abandoned'
}

/**
 * PURE. The fields that claim a document at `nowMs`, written in the transaction that read
 * it: `due` moves to `retryAtMs`, when a later attempt may take it if this one never
 * reports back.
 */
export function claimFields(nowMs: number, retryAtMs: number): DocumentData {
  return { [CLAIM_FIELD]: new Date(nowMs), due: new Date(retryAtMs) }
}

/** The field that releases a claim, written together with the attempt's result. */
export function releaseFields(): DocumentData {
  return { [CLAIM_FIELD]: FieldValue.delete() }
}
