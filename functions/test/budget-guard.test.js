// The budget guard: the kill switch's decision at each tier (50% warns, 100% engages the
// cost guard, 300% detaches billing), and the entry point's `budget-guard` set, which
// deploys `budgetAlert` on its own without the other Functions or their secrets
// (docs/DEPLOYMENT.md, "Budget guard on its own").
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const { decideBudgetActions } = require('../lib/ops/budget')
const { functionSet } = require('../lib/function-set')

/** The shipped defaults (functions/.env), with detaching on as in production. */
const CONFIG = {
  warnThreshold: 0.5,
  threshold: 1,
  detachThreshold: 3,
  detachBilling: true,
  projectId: 'uv-activity-planner',
}
const NOVEMBER = '2026-11-01T07:00:00Z'
const OCTOBER = '2026-10-01T07:00:00Z'
const NOW = new Date('2026-11-15T12:00:00Z')

function decide(percent, { current = {}, config = CONFIG, interval = NOVEMBER } = {}) {
  return decideBudgetActions({ config, current, interval, now: NOW, ratio: percent / 100 })
}

describe('budget kill switch tiers', () => {
  test('below 50% does nothing', () => {
    assert.deepEqual(decide(0), { changes: [], update: {}, detach: false })
    assert.deepEqual(decide(49.9), { changes: [], update: {}, detach: false })
  })

  test('at 50% warns once per budget period', () => {
    const first = decide(50)
    assert.deepEqual(first.changes, ['warned'])
    assert.deepEqual(first.update, { warnedIntervalStart: NOVEMBER })
    assert.equal(first.detach, false)
    // Already warned this period: nothing more until the next one.
    assert.deepEqual(decide(90, { current: { warnedIntervalStart: NOVEMBER } }).changes, [])
    // A new period warns again.
    assert.deepEqual(decide(50, { current: { warnedIntervalStart: OCTOBER } }).changes, ['warned'])
  })

  test('at 100% engages the cost guard until the next period, once', () => {
    assert.deepEqual(decide(99.9).changes, ['warned'])
    const engaged = decide(100)
    assert.deepEqual(engaged.changes, ['engaged'])
    assert.equal(engaged.update.engaged, true)
    assert.equal(engaged.update.reason, 'budget')
    assert.equal(engaged.update.engagedAt, NOW)
    assert.equal(engaged.update.engagedUntil.toISOString(), '2026-12-01T07:00:00.000Z')
    // Engaging also counts as this period's warning.
    assert.equal(engaged.update.warnedIntervalStart, NOVEMBER)
    assert.equal(engaged.detach, false)
    // Engaged in this period already: the next notification changes nothing.
    const again = decide(150, { current: { engaged: true, costIntervalStart: NOVEMBER } })
    assert.deepEqual(again, { changes: [], update: {}, detach: false })
    // Engaged in an earlier period: this period engages afresh.
    assert.deepEqual(
      decide(100, { current: { engaged: true, costIntervalStart: OCTOBER } }).changes,
      ['engaged'],
    )
  })

  test('at 300% detaches billing, on every such notification', () => {
    assert.equal(decide(299.9).detach, false)
    const detach = decide(300)
    assert.deepEqual(detach.changes, ['engaged'])
    assert.equal(detach.detach, true)
    // Repeated notifications try again (a failed detach gets another chance).
    const again = decide(400, { current: { engaged: true, costIntervalStart: NOVEMBER } })
    assert.deepEqual(again.changes, [])
    assert.equal(again.detach, true)
  })

  test('never detaches when the owner switched detaching off', () => {
    const config = { ...CONFIG, detachBilling: false }
    assert.equal(decide(1000, { config }).detach, false)
    assert.deepEqual(decide(1000, { config }).changes, ['engaged'])
  })

  test('releases a guard the budget engaged in an earlier period, not this one', () => {
    const fromOctober = { engaged: true, reason: 'budget', costIntervalStart: OCTOBER }
    const released = decide(10, { current: fromOctober })
    assert.deepEqual(released.changes, ['released'])
    assert.deepEqual(released.update, {
      engaged: false,
      releasedAt: NOW,
      reason: null,
      engagedUntil: null,
    })
    assert.deepEqual(decide(60, { current: fromOctober }).changes, ['released', 'warned'])
    // Engaged this period: a lower figure is a correction the owner decides.
    const thisPeriod = { engaged: true, reason: 'budget', costIntervalStart: NOVEMBER }
    assert.deepEqual(decide(10, { current: thisPeriod }).changes, [])
    // Pinned by the owner (reason is not the budget): left alone.
    const pinned = { engaged: true, reason: 'owner', costIntervalStart: OCTOBER }
    assert.deepEqual(decide(10, { current: pinned }).changes, [])
  })
})

describe('budget notifications out of order', () => {
  const engagedNow = { engaged: true, reason: 'budget', costIntervalStart: NOVEMBER }

  test('a late message from an earlier period never ends or rewrites this period', () => {
    for (const percent of [10, 60, 150]) {
      assert.deepEqual(decide(percent, { current: engagedNow, interval: OCTOBER }), {
        changes: [],
        update: {},
        detach: false,
      })
    }
  })

  test('a late message past the detach level still detaches billing', () => {
    assert.equal(decide(300, { current: engagedNow, interval: OCTOBER }).detach, true)
  })

  test("a dry run's past period acts on an empty or older record", () => {
    const past = '2026-09-20T12:00:00Z'
    assert.deepEqual(decide(50, { interval: past }).changes, ['warned'])
    assert.deepEqual(
      decide(100, { current: { costIntervalStart: '2026-08-20T12:00:00Z' }, interval: past })
        .changes,
      ['engaged'],
    )
  })
})

describe('Functions sets', () => {
  test('unset or empty is every Function; an unknown set fails loudly', () => {
    assert.equal(functionSet({}), 'all')
    assert.equal(functionSet({ SOLARA_FUNCTION_SET: ' ' }), 'all')
    assert.equal(functionSet({ SOLARA_FUNCTION_SET: 'all' }), 'all')
    assert.equal(functionSet({ SOLARA_FUNCTION_SET: 'budget-guard' }), 'budget-guard')
    assert.throws(() => functionSet({ SOLARA_FUNCTION_SET: 'budget' }), /use one of/)
  })

  /**
   * Loads the entry point in a fresh process with SOLARA_FUNCTION_SET, as `firebase
   * deploy` analyzes it, and reports its exports, declared params and loaded modules.
   */
  function load(set) {
    const lib = path.join(__dirname, '..', 'lib')
    const script = `
      const fns = require(${JSON.stringify(lib)})
      const { declaredParams } = require('firebase-functions/params')
      const prefix = ${JSON.stringify(lib + path.sep)}
      console.log(JSON.stringify({
        exports: Object.keys(fns).sort(),
        params: declaredParams.map(p => p.toSpec()).map(p => ({ name: p.name, type: p.type })),
        modules: Object.keys(require.cache)
          .filter(file => file.startsWith(prefix))
          .map(file => file.slice(prefix.length).split(path.sep).join('/'))
          .sort(),
        budgetAlert: fns.budgetAlert.__endpoint,
      }))`
    const output = execFileSync(
      process.execPath,
      ['-e', `const path = require('node:path');${script}`],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: { ...process.env, SOLARA_FUNCTION_SET: set },
      },
    )
    return JSON.parse(output.trim().split('\n').at(-1))
  }

  const guard = load('budget-guard')
  const all = load('all')

  test('the budget guard set exports budgetAlert alone', () => {
    assert.deepEqual(guard.exports, ['budgetAlert'])
    assert.ok(all.exports.includes('budgetAlert'))
    assert.ok(all.exports.length > 10)
  })

  test('the budget guard set declares no secret, only the kill switch params', () => {
    assert.deepEqual(guard.params.map(p => p.name).sort(), [
      'BUDGET_ID',
      'COST_GUARD_DETACH_BILLING',
      'COST_GUARD_DETACH_THRESHOLD_PERCENT',
      'COST_GUARD_THRESHOLD_PERCENT',
      'COST_GUARD_WARN_PERCENT',
    ])
    assert.deepEqual(
      guard.params.filter(p => p.type === 'secret'),
      [],
    )
    // The full set does declare secrets, which is why the guard needs its own set:
    // `firebase deploy` resolves every declared secret, whatever --only selects.
    assert.ok(all.params.some(p => p.type === 'secret'))
  })

  test('the budget guard set loads no other feature code', () => {
    assert.deepEqual(guard.modules, [
      'function-set.js',
      'index.js',
      'ops/budget-guard.js',
      'ops/budget.js',
      'shared/body-limit.js',
      'shared/cost-guard.js',
      'shared/errors.js',
      'shared/firebase.js',
      'shared/log-throttle.js',
      'shared/logging.js',
      'shared/options.js',
    ])
  })

  test('budgetAlert is the same function in both sets, so switching sets only updates it', () => {
    assert.deepEqual(guard.budgetAlert, all.budgetAlert)
  })
})
