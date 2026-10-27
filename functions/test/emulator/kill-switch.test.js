// The budget kill switch and the cost guard against the real Firestore emulator (run by
// `npm run test:rules`): a budget notification past the threshold turns the guarded
// paths off, a new budget period turns them back on, and the opt-in detach runs once
// the cost passes its own threshold.
const { after, afterEach, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const { handleBudgetNotification } = require('../../lib/ops/budget')
const { CostGuard } = require('../../lib/shared/cost-guard')

const projectId = 'demo-solara-kill-switch'
let app
let db

const CONFIG = {
  threshold: 1,
  detachThreshold: 2,
  detachBilling: false,
  projectId: 'uv-activity-planner',
}
const NOVEMBER = '2026-11-01T07:00:00Z'
const DECEMBER = '2026-12-01T08:00:00Z'

function notification(costAmount, costIntervalStart = NOVEMBER) {
  return {
    budgetDisplayName: 'Solara',
    costAmount,
    budgetAmount: 5,
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
async function guardedPathsOff() {
  return new CostGuard(db).engaged()
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
  test('stays off below the threshold and engages once at it', async () => {
    assert.deepEqual(await run(2.5), { ratio: 0.5, actions: [] })
    assert.equal(await guardedPathsOff(), false)

    assert.deepEqual((await run(5)).actions, ['engaged'])
    assert.equal(await guardedPathsOff(), true)
    const flag = (await db.doc('systemFlags/costGuard').get()).data()
    assert.equal(flag.reason, 'budget')
    assert.equal(flag.costIntervalStart, NOVEMBER)

    // Later notifications in the same period change nothing, even a lower figure.
    assert.deepEqual((await run(6)).actions, [])
    assert.deepEqual((await run(4)).actions, [])
    assert.equal(await guardedPathsOff(), true)
  })

  test('releases the guard when a new budget period starts below the threshold', async () => {
    await run(5.5)
    assert.deepEqual((await run(0.1, { interval: DECEMBER })).actions, ['released'])
    assert.equal(await guardedPathsOff(), false)
  })

  test('leaves a guard the owner pinned alone', async () => {
    await db.doc('systemFlags/costGuard').set({ override: 'engaged' })
    await run(0.1)
    assert.equal(await guardedPathsOff(), true)

    await db.doc('systemFlags/costGuard').set({ override: 'released' })
    await run(9)
    assert.equal(await guardedPathsOff(), false)
    // A guard the owner engaged by hand (no budget reason) is not released by the budget.
    await db.doc('systemFlags/costGuard').set({ engaged: true, reason: 'manual' })
    await run(0.1, { interval: DECEMBER })
    assert.equal(await guardedPathsOff(), true)
  })

  test('detaches billing only when opted in and past the detach threshold', async () => {
    const detached = []
    const disableBilling = async project => detached.push(project)
    await run(12, { disableBilling })
    assert.deepEqual(detached, [])

    const optedIn = { ...CONFIG, detachBilling: true }
    assert.deepEqual((await run(9, { config: optedIn, disableBilling })).actions, [])
    assert.deepEqual(detached, [])
    assert.deepEqual((await run(10, { config: optedIn, disableBilling })).actions, ['detached'])
    assert.deepEqual(detached, ['uv-activity-planner'])
  })

  test('surfaces a failed detach so it is logged and visible', async () => {
    const config = { ...CONFIG, detachBilling: true }
    await assert.rejects(
      run(20, {
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
