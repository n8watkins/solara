// Calendar feed capability tokens.
//
// The feed URL carries a bearer token, so the server alone mints it. Each live token is
// indexed by its SHA-256 hash in the server-only `calendarFeeds/{hash}` collection; the
// feed resolves a token with one document get, and a hash can only ever point at the
// account that minted it. The owner can read their own plaintext token (to show the link
// on any device) from `users/{uid}/private/calendarFeed`, which clients cannot write.

const { createHash, randomBytes } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const {
  FEED_TOKEN_BYTES: TOKEN_BYTES,
  FEED_TOKEN_PATTERN: TOKEN_PATTERN,
  isValidFeedToken,
} = require('#core')
const { HttpError } = require('./errors')

// The token format policy (32 random bytes as base64url, plus the legacy
// client-minted shape) lives in @solara/core, shared with the web app.
const FEEDS = 'calendarFeeds'
const LEGACY_FIELD = 'calendarFeedToken'

/**
 * @typedef {import('firebase-admin/firestore').Firestore} Firestore
 * @typedef {import('firebase-admin/firestore').DocumentReference} DocumentReference
 * @typedef {import('firebase-admin/firestore').Transaction} Transaction
 * @typedef {{ uid: string, createdAt: Date, migratedFromLegacy?: boolean }} FeedIndexDoc
 * @typedef {{ token: string, tokenHash: string, createdAt: Date }} PrivateFeedDoc
 */

function mintFeedToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** @param {string} token */
function feedTokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** @param {unknown} token @returns {token is string} */
function validFeedToken(token) {
  return isValidFeedToken(token)
}

/** @param {Firestore} db @param {string} uid */
function privateFeedRef(db, uid) {
  return db.collection('users').doc(uid).collection('private').doc('calendarFeed')
}

/** @param {Firestore} db @param {string} hash */
function feedIndexRef(db, hash) {
  return db.collection(FEEDS).doc(hash)
}

/**
 * Reads everything a mint or revoke needs and refuses accounts that are missing or being
 * deleted. Must run before any transaction write.
 *
 * @param {Firestore} db
 * @param {Transaction} transaction
 * @param {string} uid
 */
async function readFeedState(db, transaction, uid) {
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
  const currentHash = current.data()?.tokenHash
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
 *
 * @param {{ db: Firestore, uid: string, now?: Date, mint?: () => string }} options
 * @returns {Promise<{ token: string }>}
 */
async function rotateCalendarFeed({ db, uid, now = new Date(), mint = mintFeedToken }) {
  const token = mint()
  if (!TOKEN_PATTERN.test(token)) throw new Error('Minted feed token has an invalid format')
  const hash = feedTokenHash(token)
  await db.runTransaction(async transaction => {
    const { userRef, user, currentHash } = await readFeedState(db, transaction, uid)
    const collision = await transaction.get(feedIndexRef(db, hash))
    if (collision.exists) throw new Error('Feed token collision')
    if (currentHash) transaction.delete(feedIndexRef(db, currentHash))
    transaction.create(
      feedIndexRef(db, hash),
      /** @type {FeedIndexDoc} */ ({ uid, createdAt: now }),
    )
    transaction.set(
      privateFeedRef(db, uid),
      /** @type {PrivateFeedDoc} */ ({
        token,
        tokenHash: hash,
        createdAt: now,
      }),
    )
    if (user.data()?.[LEGACY_FIELD] !== undefined) {
      transaction.update(userRef, { [LEGACY_FIELD]: FieldValue.delete() })
    }
  })
  return { token }
}

/**
 * Turns the feed off: the link stops resolving immediately.
 *
 * @param {{ db: Firestore, uid: string }} options
 * @returns {Promise<{ revoked: boolean }>}
 */
async function revokeCalendarFeed({ db, uid }) {
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

/**
 * Resolves a feed token to its account uid with a single document get.
 *
 * @param {Firestore} db
 * @param {string} token
 * @returns {Promise<string | null>}
 */
async function resolveFeedOwner(db, token) {
  const snapshot = await feedIndexRef(db, feedTokenHash(token)).get()
  const uid = snapshot.exists ? snapshot.data()?.uid : null
  return typeof uid === 'string' && uid ? uid : null
}

/**
 * Removes every feed index entry that points at the account. Used by account deletion,
 * which deletes the private token document with the rest of `users/{uid}`.
 *
 * @param {Firestore} db
 * @param {string} uid
 */
async function deleteCalendarFeedsForUser(db, uid) {
  const feeds = await db.collection(FEEDS).where('uid', '==', uid).get()
  await Promise.all(feeds.docs.map(feed => feed.ref.delete()))
  return feeds.size
}

/**
 * One-time migration from the retired client-minted `users.calendarFeedToken` field.
 *
 * A legacy token is preserved (so existing calendar subscriptions keep working) only when
 * it is well formed and held by exactly one account; a token shared by several accounts
 * is exactly the hijack this scheme prevents, so every holder loses it. The legacy field
 * is removed from every account either way. Safe to run repeatedly.
 *
 * @param {{ db: Firestore, dryRun?: boolean, pageSize?: number, now?: Date, log?: (line: string) => void }} options
 */
async function migrateLegacyFeedTokens({
  db,
  dryRun = false,
  pageSize = 200,
  now = new Date(),
  log = () => {},
}) {
  /** @type {Map<string, string[]>} */
  const holders = new Map()
  /** @type {import('firebase-admin/firestore').QueryDocumentSnapshot | undefined} */
  let cursor
  for (;;) {
    let query = db.collection('users').orderBy(LEGACY_FIELD).limit(pageSize)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      const token = doc.get(LEGACY_FIELD)
      const key = typeof token === 'string' ? token : `invalid:${doc.id}`
      holders.set(key, [...(holders.get(key) ?? []), doc.id])
    }
    if (page.size < pageSize) break
    cursor = page.docs.at(-1)
  }

  const report = { scanned: 0, migrated: 0, revokedShared: 0, revokedInvalid: 0, skipped: 0 }
  for (const [token, uids] of holders) {
    for (const uid of uids) {
      report.scanned += 1
      const preserve = uids.length === 1 && validFeedToken(token)
      const outcome = await migrateOne({ db, dryRun, now, preserve, token, uid })
      if (outcome === 'migrated') report.migrated += 1
      else if (outcome === 'skipped') report.skipped += 1
      else if (uids.length > 1) report.revokedShared += 1
      else report.revokedInvalid += 1
      log(`${uid}: ${outcome}${uids.length > 1 ? ' (token shared by several accounts)' : ''}`)
    }
  }
  return report
}

/**
 * @param {{ db: Firestore, dryRun: boolean, now: Date, preserve: boolean, token: string, uid: string }} options
 * @returns {Promise<'migrated' | 'revoked' | 'skipped'>}
 */
async function migrateOne({ db, dryRun, now, preserve, token, uid }) {
  const userRef = db.collection('users').doc(uid)
  return db.runTransaction(async transaction => {
    const [user, tombstone, current] = await Promise.all([
      transaction.get(userRef),
      transaction.get(db.collection('accountDeletionTombstones').doc(uid)),
      transaction.get(privateFeedRef(db, uid)),
    ])
    const legacy = user.data()?.[LEGACY_FIELD]
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
      transaction.create(
        feedIndexRef(db, hash),
        /** @type {FeedIndexDoc} */ ({
          uid,
          createdAt: now,
          migratedFromLegacy: true,
        }),
      )
      transaction.set(
        privateFeedRef(db, uid),
        /** @type {PrivateFeedDoc} */ ({
          token: legacy,
          tokenHash: hash,
          createdAt: now,
        }),
      )
    }
    transaction.update(userRef, { [LEGACY_FIELD]: FieldValue.delete() })
    return keep ? 'migrated' : 'revoked'
  })
}

module.exports = {
  LEGACY_FIELD,
  TOKEN_PATTERN,
  deleteCalendarFeedsForUser,
  feedTokenHash,
  migrateLegacyFeedTokens,
  mintFeedToken,
  resolveFeedOwner,
  revokeCalendarFeed,
  rotateCalendarFeed,
  validFeedToken,
}
