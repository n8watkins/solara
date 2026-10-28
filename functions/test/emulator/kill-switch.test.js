// The budget kill switch and the cost guard against the real Firestore emulator (run by
// `npm run test:rules`): one warning at half the budget, a budget notification past the
// threshold turns the guarded paths off until the next budget period starts (with or
// without a notification then), and the detach runs once the cost passes its own
// threshold.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const { handleBudgetNotification } = require('../../lib/ops/budget')
const { CostGuard } = require('../../lib/shared/cost-guard')

const projectId = 'demo-solara-kill-switch'
let app
let db

// The shipped defaults (functions/.env), except that detaching is switched off here so
// a test opts in where it checks it.
const CONFIG = {
  warnThreshold: 0.5,
  threshold: 1,
  detachThreshold: 3,
  detachBilling: false,
  projectId: 'uv-activity-planner',
}
const NOVEMBER = '2026-11-01T07:00:00Z'
const DECEMBER = '2026-12-01T08:00:00Z'

function notification(costAmount, costIntervalStart = NOVEMBER) {
  return {
    budgetDisplayName: 'Solara',
    costAmount,
    budgetAmount: 25,
    costIntervalStart,
    currencyCode: 'USD',
  }
}

function run(costAmount, { interval, config = CONFIG, disableBilling } = {}) {
  return handleBudgetNotification({
    config,
    db,
    disableBilling:
      disableBilling ??
      (async () => {
        throw new Error('billing must not be detached')
      }),
    notification: notification(costAmount, interval),
  })
}

/** A fresh guard each time, as on a new instance, so nothing is cached. */
async function guardedPathsOff(now = Date.parse('2026-11-15T12:00:00Z')) {
  return new CostGuard(db, () => now).engaged()
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
  app = initializeApp({ projectId }, 'kill-switch-emulator-test')
  db = getFirestore(app)
})

afterEach(clearFirestore)

after(async () => {
  await deleteApp(app)
})

describe('budget kill switch', () => {
  test('warns once a period at half the budget, and engages once at the whole', async () => {
    assert.deepEqual(await run(5), { ratio: 0.2, actions: [] })
    assert.deepEqual((await run(12.5)).actions, ['warned'])
    assert.deepEqual((await run(20)).actions, [])
    assert.equal(await guardedPathsOff(), false)

    assert.deepEqual((await run(25)).actions, ['engaged'])
    assert.equal(await guardedPathsOff(), true)
    const flag = (await db.doc('systemFlags/costGuard').get()).data()
    assert.equal(flag.reason, 'budget')
    assert.equal(flag.costIntervalStart, NOVEMBER)
    assert.equal(flag.engagedUntil.toDate().toISOString(), '2026-12-01T07:00:00.000Z')

    // Later notifications in the same period change nothing, even a lower figure.
    assert.deepEqual((await run(30)).actions, [])
    assert.deepEqual((await run(20)).actions, [])
    assert.equal(await guardedPathsOff(), true)
  })

  test('the guard ends by itself when the next budget period starts', async () => {
    await run(27.5)
    assert.equal(await guardedPathsOff(Date.parse('2026-11-30T23:00:00Z')), true)
    // No December notification has arrived yet: the guard is off all the same.
    assert.equal(await guardedPathsOff(Date.parse('2026-12-01T07:00:00Z')), false)
  })

  test('releases the guard when a new budget period starts below the threshold', async () => {
    await run(27.5)
    assert.deepEqual((await run(0.5, { interval: DECEMBER })).actions, ['released'])
    assert.equal(await guardedPathsOff(), false)
    const flag = (await db.doc('systemFlags/costGuard').get()).data()
    assert.equal(flag.engagedUntil, null)
    // The new period warns again at half.
    assert.deepEqual((await run(13, { interval: DECEMBER })).actions, ['warned'])
  })

  test('leaves a guard the owner pinned alone', async () => {
    await db.doc('systemFlags/costGuard').set({ override: 'engaged' })
    await run(0.5)
    assert.equal(await guardedPathsOff(), true)

    await db.doc('systemFlags/costGuard').set({ override: 'released' })
    await run(45)
    assert.equal(await guardedPathsOff(), false)
    // A guard the owner engaged by hand (no budget reason) is not released by the budget.
    await db.doc('systemFlags/costGuard').set({ engaged: true, reason: 'manual' })
    await run(0.5, { interval: DECEMBER })
    assert.equal(await guardedPathsOff(Date.parse('2027-03-01T00:00:00Z')), true)
  })

  test('detaches billing only when switched on and past the detach threshold', async () => {
    const detached = []
    const disableBilling = async project => detached.push(project)
    await run(100, { disableBilling })
    assert.deepEqual(detached, [])

    const switchedOn = { ...CONFIG, detachBilling: true }
    assert.deepEqual((await run(74, { config: switchedOn, disableBilling })).actions, [])
    assert.deepEqual(detached, [])
    assert.deepEqual((await run(75, { config: switchedOn, disableBilling })).actions, ['detached'])
    assert.deepEqual(detached, ['uv-activity-planner'])
  })

  test('surfaces a failed detach so it is logged and visible', async () => {
    const config = { ...CONFIG, detachBilling: true }
    await assert.rejects(
      run(100, {
        config,
        disableBilling: async () => {
          throw new Error('Cloud Billing answered 403')
        },
      }),
      /403/,
    )
    // The cost guard was still engaged before the detach was tried.
    assert.equal(await guardedPathsOff(), true)
  })
})
