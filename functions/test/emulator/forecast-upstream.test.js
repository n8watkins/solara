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

describe("the budget's two sides (REVIEW6 L3)", () => {
  test('racing instances on both sides keep each side to two thirds and the total to the cap', async () => {
    const now = Date.parse('2026-10-27T14:05:00Z')
    const instances = ['browser', 'server', 'browser', 'server'].map(
      side =>
        new UpstreamBudget({
          db,
          side,
          limits: () => ({ perHour: 30, perDay: 1000 }),
          leaseSize: 3,
          now: () => now,
        }),
    )
    const results = await Promise.all(
      instances.map(async budget => {
        let granted = 0
        for (let i = 0; i < 25; i += 1) if (await budget.take()) granted += 1
        return granted
      }),
    )
    const [browser, server] = [results[0] + results[2], results[1] + results[3]]
    assert.equal(browser + server, 30)
    assert.ok(browser <= 20 && server <= 20, `browser ${browser}, server ${server}`)
    const count = async id => (await db.doc(`forecastUpstream/${id}`).get()).data().count
    assert.equal(await count('hour-2026-10-27T14'), 30)
    assert.equal(await count('browser-hour-2026-10-27T14'), browser)
    assert.equal(await count('server-hour-2026-10-27T14'), server)
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
