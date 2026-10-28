// The forecast upstream budget and the per-caller shares against the real Firestore
// emulator (run by `npm run test:rules`): instances racing for leases never grant more
// calls than the hourly cap in all, because each lease is one transaction over both
// counters, and instances racing for one caller never grant more than its share.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const { CallerShare } = require('../../lib/forecast/caller-share')
const { UpstreamBudget } = require('../../lib/forecast/upstream-budget')
const { addressScopes } = require('../../lib/shared/client-address')

const projectId = 'demo-solara-forecast-upstream'
let app
let db

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
  app = initializeApp({ projectId }, 'forecast-upstream-emulator-test')
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

describe('forecast upstream budget', () => {
  test('five racing instances grant exactly the hourly cap', async () => {
    const now = Date.parse('2026-10-27T14:05:00Z')
    const instances = Array.from(
      { length: 5 },
      () =>
        new UpstreamBudget({
          db,
          limits: () => ({ perHour: 37, perDay: 1000 }),
          leaseSize: 4,
          now: () => now,
        }),
    )
    const results = await Promise.all(
      instances.flatMap(budget => Array.from({ length: 20 }, () => budget.take())),
    )
    assert.equal(results.filter(Boolean).length, 37)
    const hour = (await db.doc('forecastUpstream/hour-2026-10-27T14').get()).data()
    const day = (await db.doc('forecastUpstream/day-2026-10-27').get()).data()
    assert.equal(hour.count, 37)
    assert.equal(day.count, 37)
    assert.ok(hour.expireAt.toDate() > new Date(now))
  })
})

describe('caller shares (REVIEW4 H1)', () => {
  test('three racing instances grant one caller exactly its share, and a /48 four shares', async () => {
    const now = Date.parse('2026-10-27T14:05:00Z')
    const instances = Array.from(
      { length: 3 },
      () => new CallerShare({ db, scope: 'forecast', perHour: () => 5, now: () => now }),
    )
    const one = await Promise.all(
      instances.flatMap(share =>
        Array.from({ length: 10 }, () => share.take(addressScopes('203.0.113.66'))),
      ),
    )
    assert.equal(one.filter(Boolean).length, 5)

    const site = await Promise.all(
      instances.flatMap((share, i) =>
        Array.from({ length: 20 }, (_, n) =>
          share.take(addressScopes(`2001:db8:1:${(i * 20 + n).toString(16)}::1`)),
        ),
      ),
    )
    assert.equal(site.filter(Boolean).length, 20)
  })
})
