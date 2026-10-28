// The free trial is once per person, not once per account (REVIEW3 M4).
//
// Deleting an account removes its user document and its Stripe customer, so neither
// remembers a trial. One minimal record survives instead, in the server-only
// `trialHistory` collection: for each trial, a keyed hash (HMAC-SHA256 with the
// TRIAL_HISTORY_KEY secret) of
//
// - each sign-in provider's stable user id (the Google account's `sub`), which stays
//   the same when the person deletes their Solara account and signs in again;
// - the verified email address, trimmed and lowercased;
// - the card's fingerprint (Stripe's id for a card number, the same across customers).
//
// A keyed hash cannot be reversed or recomputed from a guessed address without the
// secret, and the record holds nothing else: its kind, a keyed hash of the subscription
// that used the trial (so a retried webhook is not mistaken for a second trial), and
// `expireAt`, two years on (RETENTION_DAYS.trialHistory). The privacy policy says so.
//
// Checkout offers no trial when a sign-in identity or the verified email is on record.
// A card is known only once paid, so the webhook ends a trial at once (billing starts
// now) when its card is on record from another trial.

import { createHmac } from 'node:crypto'

import type { DecodedIdToken, UserRecord } from 'firebase-admin/auth'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'

import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'

export const TRIAL_HISTORY_COLLECTION = 'trialHistory'

/** What a record is keyed on. */
export type TrialKeyKind = 'identity' | 'email' | 'card'

export interface TrialKey {
  kind: TrialKeyKind
  /** The document id: a hex HMAC of the kind and the value. */
  id: string
}

/** The sign-in facts a trial is remembered by. */
export interface TrialIdentity {
  /** Federated sign-in accounts: the provider (`google.com`) and its stable user id. */
  providers: { providerId: string; uid: string }[]
  email: string | null
  emailVerified: boolean
}

// An email/password sign-in's "uid" at the provider is the address itself, which the
// email key already covers (only when verified).
const NOT_A_STABLE_ID = new Set(['email', 'password'])

function stableProviders(entries: [string, unknown][]): TrialIdentity['providers'] {
  return entries.flatMap(([providerId, uid]) =>
    !NOT_A_STABLE_ID.has(providerId) && typeof uid === 'string' && uid ? [{ providerId, uid }] : [],
  )
}

/** The trial identity of a verified ID token (checkout). */
export function identityFromToken(token: DecodedIdToken): TrialIdentity {
  const identities = (token.firebase?.identities ?? {}) as Record<string, unknown>
  const entries = Object.entries(identities).flatMap(([providerId, ids]): [string, unknown][] =>
    Array.isArray(ids) ? ids.map(id => [providerId, id] as [string, unknown]) : [],
  )
  return {
    providers: stableProviders(entries),
    email: typeof token.email === 'string' ? token.email : null,
    emailVerified: token.email_verified === true,
  }
}

/** The trial identity of an Auth user record (the webhook, which has no token). */
export function identityFromUser(
  user: Pick<UserRecord, 'email' | 'emailVerified' | 'providerData'>,
): TrialIdentity {
  return {
    providers: stableProviders(
      (user.providerData ?? []).map(info => [info.providerId, info.uid] as [string, unknown]),
    ),
    email: user.email ?? null,
    emailVerified: user.emailVerified === true,
  }
}

function unique(keys: readonly TrialKey[]): TrialKey[] {
  return [...new Map(keys.map(key => [key.id, key])).values()]
}

export class TrialHistory {
  private readonly key: string

  constructor(
    private readonly db: Firestore,
    key: string,
  ) {
    if (!key || !key.trim()) throw new Error('TRIAL_HISTORY_KEY is not configured')
    this.key = key
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex')
  }

  private trialKey(kind: TrialKeyKind, value: string): TrialKey {
    return { kind, id: this.hmac(`${kind}\0${value}`) }
  }

  /** The keys of a sign-in: each provider account, and the email address once verified. */
  identityKeys(identity: TrialIdentity): TrialKey[] {
    const keys = identity.providers.map(({ providerId, uid }) =>
      this.trialKey('identity', `${providerId}\0${uid}`),
    )
    const email = identity.email?.trim().toLowerCase()
    if (email && identity.emailVerified) keys.push(this.trialKey('email', email))
    return keys
  }

  /** The key of a card, from its Stripe fingerprint. */
  cardKey(fingerprint: string): TrialKey {
    return this.trialKey('card', fingerprint)
  }

  private ref(key: TrialKey): DocumentReference {
    return this.db.collection(TRIAL_HISTORY_COLLECTION).doc(key.id)
  }

  /** Whether any of these keys already had a trial. */
  async used(allKeys: readonly TrialKey[]): Promise<boolean> {
    const keys = unique(allKeys)
    if (keys.length === 0) return false
    const snapshots = await this.db.getAll(...keys.map(key => this.ref(key)))
    return snapshots.some(snapshot => snapshot.exists)
  }

  /**
   * Records that `subscriptionId` used a trial under these keys, and says whether any of
   * them had a trial from another subscription before. Idempotent: recording the same
   * subscription again (a retried webhook) is not a reuse. A reused key's record is
   * kept for another two years.
   */
  async record(allKeys: readonly TrialKey[], subscriptionId: string): Promise<{ reused: boolean }> {
    const keys = unique(allKeys)
    if (keys.length === 0) return { reused: false }
    const trial = this.hmac(`subscription\0${subscriptionId}`)
    const refs = keys.map(key => this.ref(key))
    return this.db.runTransaction(async transaction => {
      const snapshots = await transaction.getAll(...refs)
      const expireAt = expiresAfter(RETENTION_DAYS.trialHistory)
      let reused = false
      snapshots.forEach((snapshot, index) => {
        const ref = refs[index] as DocumentReference
        const key = keys[index] as TrialKey
        if (!snapshot.exists) {
          transaction.set(ref, { kind: key.kind, trial, expireAt })
        } else if (snapshot.data()?.trial !== trial) {
          reused = true
          transaction.set(ref, { expireAt }, { merge: true })
        }
      })
      return { reused }
    })
  }
}
