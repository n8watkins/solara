// The browser deletion's "just deleted" markers are removed a day later by the
// maintenance job (functions/src/account/self-deletion.ts, REVIEW9 SEC9 L3).
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { Timestamp, getFirestore } = require('firebase-admin/firestore')

const {
  SELF_DELETION_KEEP_MS,
  pruneSelfDeletionMarkers,
} = require('../../lib/account/self-deletion')

const projectId = 'demo-solara-self-deletion'
const NOW = Date.parse('2026-10-29T17:00:00Z')
let app
let db

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
  app = initializeApp({ projectId }, 'self-deletion-emulator-test')
  db = getFirestore(app)
})

afterEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  assert.equal(response.ok, true)
})

after(async () => {
  await deleteApp(app)
})

async function mark(uid, ageMs) {
  await db.doc(`accountSelfDeletions/${uid}`).set({ deletedAt: Timestamp.fromMillis(NOW - ageMs) })
}

const ids = async () => (await db.collection('accountSelfDeletions').get()).docs.map(doc => doc.id)

describe('self-deletion markers', () => {
  test('a run removes the markers a day old and keeps the recent ones', async () => {
    await mark('old', SELF_DELETION_KEEP_MS + 1)
    await mark('older', 7 * SELF_DELETION_KEEP_MS)
    await mark('recent', 30 * 60 * 1000)
    assert.deepEqual(await pruneSelfDeletionMarkers({ db, nowMs: NOW }), { removed: 2 })
    assert.deepEqual(await ids(), ['recent'])
    assert.deepEqual(await pruneSelfDeletionMarkers({ db, nowMs: NOW }), { removed: 0 })
  })

  test('a run removes at most its limit, the next one the rest', async () => {
    for (let i = 0; i < 5; i++) await mark(`u${i}`, SELF_DELETION_KEEP_MS + 1)
    assert.deepEqual(await pruneSelfDeletionMarkers({ db, nowMs: NOW, limit: 3 }), { removed: 3 })
    assert.deepEqual(await pruneSelfDeletionMarkers({ db, nowMs: NOW, limit: 3 }), { removed: 2 })
    assert.deepEqual(await ids(), [])
  })
})
