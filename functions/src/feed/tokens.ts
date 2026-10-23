// Calendar feed capability tokens.
//
// The feed URL carries a bearer token, so the server alone mints it. Each live token is
// indexed by its SHA-256 hash in the server-only `calendarFeeds/{hash}` collection; the
// feed resolves a token with one document get, and a hash can only ever point at the
// account that minted it. The owner can read their own plaintext token (to show the link
// on any device) from `users/{uid}/private/calendarFeed`, which clients cannot write.

import { createHash, randomBytes } from 'node:crypto'

import { FEED_TOKEN_BYTES, FEED_TOKEN_PATTERN, isValidFeedToken } from '#core'
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore'

import { HttpError } from '../shared/errors'

// The token format policy (32 random bytes as base64url, plus the legacy
// client-minted shape) lives in @solara/core, shared with the web app.
export const TOKEN_PATTERN = FEED_TOKEN_PATTERN
const FEEDS = 'calendarFeeds'
export const LEGACY_FIELD = 'calendarFeedToken'

interface FeedIndexDoc {
  uid: string
  createdAt: Date
  migratedFromLegacy?: boolean
}

interface PrivateFeedDoc {
  token: string
  tokenHash: string
  createdAt: Date
}

export function mintFeedToken(): string {
  return randomBytes(FEED_TOKEN_BYTES).toString('base64url')
}

export function feedTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function validFeedToken(token: unknown): token is string {
  return isValidFeedToken(token)
}

function privateFeedRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('users').doc(uid).collection('private').doc('calendarFeed')
}

function feedIndexRef(db: Firestore, hash: string): DocumentReference {
  return db.collection(FEEDS).doc(hash)
}

/**
 * Reads everything a mint or revoke needs and refuses accounts that are missing or being
 * deleted. Must run before any transaction write.
 */
async function readFeedState(db: Firestore, transaction: Transaction, uid: string) {
  const userRef = db.collection('users').doc(uid)
  const [user, tombstone, current] = await Promise.all([
    transaction.get(userRef),
    transaction.get(db.collection('accountDeletionTombstones').doc(uid)),
    transaction.get(privateFeedRef(db, uid)),
  ])
  if (tombstone.exists || user.data()?.accountDeletionStartedAt) {
    throw new HttpError('deletion-in-progress', 'Account deletion is in progress')
  }
  if (!user.exists) throw new HttpError('not-found', 'Account does not exist')
  const currentHash: unknown = current.data()?.tokenHash
  return {
    userRef,
    user,
    currentHash: typeof currentHash === 'string' && currentHash ? currentHash : null,
  }
}

/**
 * Creates a new feed token for the account and revokes the previous one atomically.
 * The token never comes from the request, so a copied link cannot be claimed by another
 * account.
 */
export async function rotateCalendarFeed({
  db,
  uid,
  now = new Date(),
  mint = mintFeedToken,
}: {
  db: Firestore
  uid: string
  now?: Date
  mint?: () => string
}): Promise<{ token: string }> {
  const token = mint()
  if (!FEED_TOKEN_PATTERN.test(token)) throw new Error('Minted feed token has an invalid format')
  const hash = feedTokenHash(token)
  await db.runTransaction(async transaction => {
    const { userRef, user, currentHash } = await readFeedState(db, transaction, uid)
    const collision = await transaction.get(feedIndexRef(db, hash))
    if (collision.exists) throw new Error('Feed token collision')
    if (currentHash) transaction.delete(feedIndexRef(db, currentHash))
    transaction.create(feedIndexRef(db, hash), { uid, createdAt: now } satisfies FeedIndexDoc)
    transaction.set(privateFeedRef(db, uid), {
      token,
      tokenHash: hash,
      createdAt: now,
    } satisfies PrivateFeedDoc)
    if (user.data()?.[LEGACY_FIELD] !== undefined) {
      transaction.update(userRef, { [LEGACY_FIELD]: FieldValue.delete() })
    }
  })
  return { token }
}

/** Turns the feed off: the link stops resolving immediately. */
export async function revokeCalendarFeed({
  db,
  uid,
}: {
  db: Firestore
  uid: string
}): Promise<{ revoked: boolean }> {
  return db.runTransaction(async transaction => {
    const { userRef, user, currentHash } = await readFeedState(db, transaction, uid)
    if (currentHash) transaction.delete(feedIndexRef(db, currentHash))
    transaction.delete(privateFeedRef(db, uid))
    if (user.data()?.[LEGACY_FIELD] !== undefined) {
      transaction.update(userRef, { [LEGACY_FIELD]: FieldValue.delete() })
    }
    return { revoked: currentHash !== null }
  })
}

/** Resolves a feed token to its account uid with a single document get. */
export async function resolveFeedOwner(db: Firestore, token: string): Promise<string | null> {
  const snapshot = await feedIndexRef(db, feedTokenHash(token)).get()
  const uid: unknown = snapshot.exists ? snapshot.data()?.uid : null
  return typeof uid === 'string' && uid ? uid : null
}

/**
 * Removes every feed index entry that points at the account. Used by account deletion,
 * which deletes the private token document with the rest of `users/{uid}`.
 */
export async function deleteCalendarFeedsForUser(db: Firestore, uid: string): Promise<number> {
  const feeds = await db.collection(FEEDS).where('uid', '==', uid).get()
  await Promise.all(feeds.docs.map(feed => feed.ref.delete()))
  return feeds.size
}

type MigrationOutcome = 'migrated' | 'revoked' | 'skipped'

export interface MigrationReport {
  scanned: number
  migrated: number
  revokedShared: number
  revokedInvalid: number
  skipped: number
}

/**
 * One-time migration from the retired client-minted `users.calendarFeedToken` field.
 *
 * A legacy token is preserved (so existing calendar subscriptions keep working) only when
 * it is well formed and held by exactly one account; a token shared by several accounts
 * is exactly the hijack this scheme prevents, so every holder loses it. The legacy field
 * is removed from every account either way. Safe to run repeatedly.
 */
export async function migrateLegacyFeedTokens({
  db,
  dryRun = false,
  pageSize = 200,
  now = new Date(),
  log = () => {},
}: {
  db: Firestore
  dryRun?: boolean
  pageSize?: number
  now?: Date
  log?: (uid: string, outcome: MigrationOutcome, shared: boolean) => void
}): Promise<MigrationReport> {
  const holders = new Map<string, string[]>()
  let cursor: QueryDocumentSnapshot | undefined
  for (;;) {
    let query = db.collection('users').orderBy(LEGACY_FIELD).limit(pageSize)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      const token: unknown = doc.get(LEGACY_FIELD)
      const key = typeof token === 'string' ? token : `invalid:${doc.id}`
      holders.set(key, [...(holders.get(key) ?? []), doc.id])
    }
    if (page.size < pageSize) break
    cursor = page.docs.at(-1)
  }

  const report: MigrationReport = {
    scanned: 0,
    migrated: 0,
    revokedShared: 0,
    revokedInvalid: 0,
    skipped: 0,
  }
  for (const [token, uids] of holders) {
    for (const uid of uids) {
      report.scanned += 1
      const preserve = uids.length === 1 && validFeedToken(token)
      const outcome = await migrateOne({ db, dryRun, now, preserve, token, uid })
      if (outcome === 'migrated') report.migrated += 1
      else if (outcome === 'skipped') report.skipped += 1
      else if (uids.length > 1) report.revokedShared += 1
      else report.revokedInvalid += 1
      log(uid, outcome, uids.length > 1)
    }
  }
  return report
}

async function migrateOne({
  db,
  dryRun,
  now,
  preserve,
  token,
  uid,
}: {
  db: Firestore
  dryRun: boolean
  now: Date
  preserve: boolean
  token: string
  uid: string
}): Promise<MigrationOutcome> {
  const userRef = db.collection('users').doc(uid)
  return db.runTransaction(async transaction => {
    const [user, tombstone, current] = await Promise.all([
      transaction.get(userRef),
      transaction.get(db.collection('accountDeletionTombstones').doc(uid)),
      transaction.get(privateFeedRef(db, uid)),
    ])
    const legacy: unknown = user.data()?.[LEGACY_FIELD]
    if (!user.exists || legacy === undefined) return 'skipped'
    const hash = typeof legacy === 'string' ? feedTokenHash(legacy) : null
    const index = hash ? await transaction.get(feedIndexRef(db, hash)) : null
    const keep =
      preserve &&
      legacy === token &&
      hash !== null &&
      !tombstone.exists &&
      !user.data()?.accountDeletionStartedAt &&
      !current.exists &&
      !index?.exists
    if (dryRun) return keep ? 'migrated' : 'revoked'
    if (keep && hash) {
      transaction.create(feedIndexRef(db, hash), {
        uid,
        createdAt: now,
        migratedFromLegacy: true,
      } satisfies FeedIndexDoc)
      transaction.set(privateFeedRef(db, uid), {
        token: legacy,
        tokenHash: hash,
        createdAt: now,
      } satisfies PrivateFeedDoc)
    }
    transaction.update(userRef, { [LEGACY_FIELD]: FieldValue.delete() })
    return keep ? 'migrated' : 'revoked'
  })
}
