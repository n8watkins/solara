// Calendar feed tokens against the real Firestore emulator (run by `npm run test:rules`).
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const { createCalendarFeedHandler, clearFeedRateLimits } = require('../../lib/feed/calendar-feed')
const {
  deleteCalendarFeedsForUser,
  feedTokenHash,
  migrateLegacyFeedTokens,
  revokeCalendarFeed,
  rotateCalendarFeed,
} = require('../../lib/feed/tokens')

const projectId = 'demo-solara-feeds'
/** @type {import('firebase-admin/app').App} */
let app
/** @type {import('firebase-admin/firestore').Firestore} */
let db

function prefs(uid, overrides = {}) {
  return {
    uid,
    schemaVersion: 2,
    location: { lat: 47.61, lon: -122.33, city: 'Seattle', region: 'WA' },
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'free',
    onboardingComplete: true,
    ...overrides,
  }
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    set(name, value) {
      this.headers[name] = value
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    send(body) {
      this.body = body
      return this
    },
  }
}

/** A feed handler whose ICS body names the account it was built for. */
function feedHandler() {
  return createCalendarFeedHandler({
    buildICS: events => `calendar for ${events[0]?.owner ?? 'nobody'}`,
    buildSunEvents: user => [{ owner: user.uid }],
    db,
    days: 7,
    fetchForecast: async () => [],
  })
}

async function fetchFeed(token) {
  const res = responseRecorder()
  await feedHandler()({ method: 'GET', query: { token }, headers: {} }, res)
  return res
}

async function clearFirestore() {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  assert.equal(response.ok, true)
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
  app = initializeApp({ projectId }, 'feed-tokens-emulator-test')
  db = getFirestore(app)
})

afterEach(async () => {
  clearFeedRateLimits()
  await clearFirestore()
})

after(async () => {
  await deleteApp(app)
})

describe('server-minted calendar feed tokens', () => {
  test('mints a token indexed only by its hash and readable by its owner', async () => {
    await db.doc('users/alice').set(prefs('alice'))
    const { token } = await rotateCalendarFeed({ db, uid: 'alice' })

    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    const index = await db.doc(`calendarFeeds/${feedTokenHash(token)}`).get()
    assert.equal(index.get('uid'), 'alice')
    assert.equal(JSON.stringify(index.data()).includes(token), false)
    const privateDoc = await db.doc('users/alice/private/calendarFeed').get()
    assert.equal(privateDoc.get('token'), token)

    const res = await fetchFeed(token)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'calendar for alice')
  })

  test('a copied token cannot hijack another feed', async () => {
    await db.doc('users/alice').set(prefs('alice'))
    await db.doc('users/mallory').set(prefs('mallory'))
    const alice = await rotateCalendarFeed({ db, uid: 'alice' })

    // Mallory copies Alice's link and tries every server path to bind it to her account.
    const malloryMint = await rotateCalendarFeed({ db, uid: 'mallory', mint: () => alice.token })
      .then(() => 'minted')
      .catch(error => error.message)
    assert.equal(malloryMint, 'Feed token collision')
    await db.doc('users/mallory').update({ calendarFeedToken: alice.token })
    const mallory = await rotateCalendarFeed({ db, uid: 'mallory' })
    await migrateLegacyFeedTokens({ db })

    // Alice's link still resolves to Alice; Mallory only ever gets her own feed.
    assert.equal((await fetchFeed(alice.token)).body, 'calendar for alice')
    assert.equal((await fetchFeed(mallory.token)).body, 'calendar for mallory')
    assert.equal(
      (await db.doc(`calendarFeeds/${feedTokenHash(alice.token)}`).get()).get('uid'),
      'alice',
    )
  })

  test('rotation revokes the previous link and revoke turns the feed off', async () => {
    await db.doc('users/alice').set(prefs('alice'))
    const first = await rotateCalendarFeed({ db, uid: 'alice' })
    const second = await rotateCalendarFeed({ db, uid: 'alice' })
    assert.notEqual(first.token, second.token)
    assert.equal((await fetchFeed(first.token)).statusCode, 404)
    assert.equal((await fetchFeed(second.token)).statusCode, 200)

    assert.deepEqual(await revokeCalendarFeed({ db, uid: 'alice' }), { revoked: true })
    assert.equal((await fetchFeed(second.token)).statusCode, 404)
    assert.equal((await db.doc('users/alice/private/calendarFeed').get()).exists, false)
    assert.equal((await db.collection('calendarFeeds').get()).size, 0)
  })

  test('refuses accounts that are missing or being deleted', async () => {
    await assert.rejects(rotateCalendarFeed({ db, uid: 'ghost' }), { code: 'not-found' })
    await db.doc('users/alice').set(prefs('alice'))
    await db.doc('accountDeletionTombstones/alice').set({ cleanupStatus: 'pending' })
    await assert.rejects(rotateCalendarFeed({ db, uid: 'alice' }), {
      code: 'deletion-in-progress',
    })
  })

  test('account deletion removes every index entry for the account', async () => {
    await db.doc('users/alice').set(prefs('alice'))
    await db.doc('users/bob').set(prefs('bob'))
    const alice = await rotateCalendarFeed({ db, uid: 'alice' })
    const bob = await rotateCalendarFeed({ db, uid: 'bob' })
    await db.collection('calendarFeeds').doc('stray').set({ uid: 'alice' })

    assert.equal(await deleteCalendarFeedsForUser(db, 'alice'), 2)
    assert.equal((await fetchFeed(alice.token)).statusCode, 404)
    assert.equal((await fetchFeed(bob.token)).statusCode, 200)
  })
})

describe('legacy feed token migration', () => {
  const UNIQUE = 'U'.repeat(32)
  const SHARED = 'S'.repeat(40)

  async function seedLegacy() {
    await db.doc('users/unique').set(prefs('unique', { calendarFeedToken: UNIQUE }))
    await db.doc('users/victim').set(prefs('victim', { calendarFeedToken: SHARED }))
    await db.doc('users/attacker').set(prefs('attacker', { calendarFeedToken: SHARED }))
    await db.doc('users/weak').set(prefs('weak', { calendarFeedToken: 'short-token-123' }))
    await db.doc('users/typed').set(prefs('typed', { calendarFeedToken: 42 }))
    await db
      .doc('users/deleting')
      .set(prefs('deleting', { calendarFeedToken: 'D'.repeat(32), accountDeletionStartedAt: 1 }))
    await db.doc('users/none').set(prefs('none'))
  }

  test('dry run reports outcomes without writing', async () => {
    await seedLegacy()
    const report = await migrateLegacyFeedTokens({ db, dryRun: true, pageSize: 2 })
    assert.deepEqual(report, {
      scanned: 6,
      migrated: 1,
      revokedShared: 2,
      revokedInvalid: 3,
      skipped: 0,
    })
    assert.equal((await db.collection('calendarFeeds').get()).size, 0)
    assert.equal((await db.doc('users/unique').get()).get('calendarFeedToken'), UNIQUE)
  })

  test('keeps a unique token working, revokes shared and invalid ones, and is idempotent', async () => {
    await seedLegacy()
    const report = await migrateLegacyFeedTokens({ db, pageSize: 2 })
    assert.equal(report.migrated, 1)
    assert.equal(report.revokedShared, 2)

    assert.equal((await fetchFeed(UNIQUE)).body, 'calendar for unique')
    assert.equal((await fetchFeed(SHARED)).statusCode, 404)
    assert.equal((await db.doc('users/unique/private/calendarFeed').get()).get('token'), UNIQUE)
    const remaining = await db.collection('users').orderBy('calendarFeedToken').get()
    assert.equal(remaining.size, 0)
    assert.equal((await db.collection('calendarFeeds').get()).size, 1)

    assert.deepEqual(await migrateLegacyFeedTokens({ db }), {
      scanned: 0,
      migrated: 0,
      revokedShared: 0,
      revokedInvalid: 0,
      skipped: 0,
    })
  })
})
