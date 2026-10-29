// Cost and abuse hardening for the Blaze plan: runtime ceilings on every function, App
// Check on every browser endpoint, per-address, per-account and body size limits, the
// cost guard, the budget kill switch's parsing and the maintenance run.
const { afterEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { authenticate, clearUidLimiters, uidLimiter } = require('../lib/shared/auth')
const { CostGuard, guardEngaged } = require('../lib/shared/cost-guard')
const { createApiHandler } = require('../lib/shared/http')
const {
  budgetServiceAccount,
  cloudBillingDisabler,
  fromExpectedBudget,
  nextBudgetPeriodStart,
  parseBudgetNotification,
} = require('../lib/ops/budget')
const { runMaintenance } = require('../lib/ops/maintenance')
const { createCalendarFeedHandler, clearFeedRateLimits } = require('../lib/feed/calendar-feed')
const { captureLogs } = require('./support/logs')

const logs = captureLogs()
const ORIGIN = 'https://app.example.com'

afterEach(() => {
  clearUidLimiters()
  clearFeedRateLimits()
})

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
    json(body) {
      this.body = body
      return this
    },
  }
}

const validAppCheck = { verifyToken: async () => ({ appId: 'app', token: {} }) }

function post(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: ORIGIN, 'x-firebase-appcheck': 'token', 'x-forwarded-for': '203.0.113.9' },
    body: {},
    ...overrides,
  }
}

function endpoint(options = {}) {
  return createApiHandler({
    name: 'testEndpoint',
    method: 'POST',
    allowedOrigin: () => ORIGIN,
    appCheck: () => validAppCheck,
    appCheckMode: 'standard',
    fallbackMessage: 'Service unavailable',
    handler: async () => ({ body: { ok: true } }),
    ...options,
  })
}

describe('deployed runtime ceilings', () => {
  process.env.GCLOUD_PROJECT ??= 'demo-solara'
  const functions = require('..')

  test('every function has small memory, a timeout and an instance cap', () => {
    for (const [name, fn] of Object.entries(functions)) {
      const endpoint = fn.__endpoint
      assert.ok(endpoint, `${name} is not a Cloud Function`)
      assert.equal(endpoint.availableMemoryMb, 256, `${name} memory`)
      assert.ok(endpoint.maxInstances >= 1 && endpoint.maxInstances <= 5, `${name} maxInstances`)
      assert.ok(endpoint.timeoutSeconds > 0 && endpoint.timeoutSeconds <= 300, `${name} timeout`)
      assert.ok(endpoint.concurrency >= 1 && endpoint.concurrency <= 80, `${name} concurrency`)
      assert.deepEqual(endpoint.region, ['us-central1'], `${name} region`)
    }
  })

  test('HTTP instance caps come from one table and stay at launch size', () => {
    const { INSTANCE_CAPS } = require('../lib/shared/options')
    const http = Object.entries(functions).filter(([, fn]) => fn.__endpoint.httpsTrigger)
    assert.deepEqual(http.map(([name]) => name).sort(), Object.keys(INSTANCE_CAPS).sort())
    for (const [name, fn] of http) {
      assert.equal(fn.__endpoint.maxInstances, INSTANCE_CAPS[name], name)
    }
    // The worst case in docs/COSTS.md is computed for at most 16 HTTP instances in all.
    const total = http.reduce((sum, [, fn]) => sum + fn.__endpoint.maxInstances, 0)
    assert.ok(total <= 16, `HTTP instances in all: ${total}`)
  })

  test('background functions run one small instance and are not retried', () => {
    const { budgetAlert, maintenance } = functions
    assert.equal(maintenance.__endpoint.maxInstances, 1)
    assert.equal(maintenance.__endpoint.cpu, 'gcf_gen1')
    assert.equal(maintenance.__endpoint.scheduleTrigger.retryConfig.retryCount, 0)
    assert.equal(budgetAlert.__endpoint.maxInstances, 1)
    assert.equal(budgetAlert.__endpoint.eventTrigger.retry, false)
    assert.equal(budgetAlert.__endpoint.eventTrigger.eventFilters.topic, 'budget-alerts')
    // The default identity until BUDGET_SERVICE_ACCOUNT names one.
    assert.notEqual(typeof budgetAlert.__endpoint.serviceAccountEmail, 'string')
  })

  test("stays within Cloud Scheduler's three free jobs: maintenance, alerts and the linked calendar refresh", () => {
    const scheduled = Object.entries(functions).filter(([, fn]) => fn.__endpoint.scheduleTrigger)
    assert.deepEqual(scheduled.map(([name]) => name).sort(), [
      'alerts',
      'eventSubscriptionsRefresh',
      'maintenance',
    ])
    const refresh = functions.eventSubscriptionsRefresh.__endpoint
    assert.equal(refresh.scheduleTrigger.schedule, 'every 30 minutes')
    assert.equal(refresh.scheduleTrigger.retryConfig.retryCount, 0)
    assert.equal(refresh.maxInstances, 1)
    assert.equal(refresh.concurrency, 1)
    const { alerts } = functions
    assert.equal(alerts.__endpoint.scheduleTrigger.schedule, 'every 15 minutes')
    assert.equal(alerts.__endpoint.scheduleTrigger.retryConfig.retryCount, 0)
    assert.equal(alerts.__endpoint.maxInstances, 1)
    assert.equal(alerts.__endpoint.concurrency, 1)
    // The default runtime identity until ALERTS_SERVICE_ACCOUNT names one.
    assert.notEqual(typeof alerts.__endpoint.serviceAccountEmail, 'string')
  })

  test('every HTTP function verifies App Check, except the two token-checked ones', () => {
    const { APP_CHECK_ENDPOINTS } = require('../lib/shared/browser-api')
    const http = Object.entries(functions)
      .filter(([, fn]) => fn.__endpoint.httpsTrigger)
      .map(([name]) => name)
    const unchecked = http.filter(name => !APP_CHECK_ENDPOINTS.has(name))
    // stripeWebhook: Stripe signature. calendarFeed: feed token, rate limited.
    assert.deepEqual(unchecked.sort(), ['calendarFeed', 'stripeWebhook'])
  })

  test('the Stripe webhook refuses floods and oversized bodies before verifying', async () => {
    const big = responseRecorder()
    await functions.stripeWebhook(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        rawBody: Buffer.alloc(300 * 1024),
      },
      big,
    )
    assert.equal(big.statusCode, 413)
  })

  test('a flood of forged Stripe webhooks logs once a minute and is limited per address', async () => {
    process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test_flood'
    const post = (address, signature) => ({
      method: 'POST',
      headers: { 'x-forwarded-for': address, 'stripe-signature': signature },
      rawBody: Buffer.from('{"id":"evt_forged","object":"event"}'),
    })
    const statuses = []
    for (let i = 0; i < 500; i += 1) {
      const res = responseRecorder()
      // 10 addresses, each sending a well-formed forged signature or a malformed header.
      const signature =
        i % 2 ? `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` : 'nonsense'
      await functions.stripeWebhook(post(`203.0.113.${i % 10}`, signature), res)
      statuses.push(res.statusCode)
    }
    assert.deepEqual([...new Set(statuses)], [400])
    // One address gets 60 a minute (Stripe sends far fewer); the rest are turned away.
    const one = []
    for (let i = 0; i < 70; i += 1) {
      const res = responseRecorder()
      await functions.stripeWebhook(post('198.51.100.77', 'nonsense'), res)
      one.push(res.statusCode)
    }
    assert.deepEqual(one.slice(0, 60), Array(60).fill(400))
    assert.deepEqual(one.slice(60), Array(10).fill(429))
    const rejected = logs.entries.filter(entry => entry.message.startsWith('stripeWebhook'))
    assert.ok(rejected.length <= 2, `${rejected.length} webhook log lines for a flood of 570`)
    for (const entry of rejected) assert.equal(entry.severity, 'WARNING')
  })
})

describe('browser endpoint limits', () => {
  test('turns away a flood from one address before App Check', async () => {
    let verified = 0
    const handle = endpoint({
      perAddressPerMinute: 2,
      appCheck: () => ({
        verifyToken: async () => {
          verified += 1
          return { appId: 'app', token: {} }
        },
      }),
    })
    for (let i = 0; i < 2; i += 1) {
      const res = responseRecorder()
      await handle(post(), res)
      assert.equal(res.statusCode, 200)
    }
    const limited = responseRecorder()
    await handle(post(), limited)
    assert.equal(limited.statusCode, 429)
    assert.equal(limited.body.code, 'rate-limited')
    assert.ok(Number(limited.headers['Retry-After']) >= 1)
    assert.equal(verified, 2)
    // Another address still gets through.
    const other = responseRecorder()
    await handle(post({ headers: { ...post().headers, 'x-forwarded-for': '203.0.113.10' } }), other)
    assert.equal(other.statusCode, 200)
  })

  test('refuses an oversized body with 413 before App Check', async () => {
    const handle = endpoint({ maxBodyBytes: 16 })
    const res = responseRecorder()
    await handle(post({ rawBody: Buffer.alloc(17) }), res)
    assert.equal(res.statusCode, 413)
    assert.deepEqual(res.body, { error: 'Request too large', code: 'payload-too-large' })
    const declared = responseRecorder()
    await handle(post({ headers: { ...post().headers, 'content-length': '4096' } }), declared)
    assert.equal(declared.statusCode, 413)
  })

  test('answers 503 while the cost guard is engaged, and needs a guard to be guarded', async () => {
    const guard = { engaged: async () => true }
    const handle = endpoint({ costFeature: 'notifications', costGuard: () => guard })
    const res = responseRecorder()
    await handle(post(), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'unavailable')
    assert.throws(() => endpoint({ costFeature: 'notifications' }), /needs a costGuard/)
  })

  test('holds one account to its per-endpoint budget after verifying it', async () => {
    const limiter = uidLimiter(2)
    const auth = { verifyIdToken: async () => ({ uid: 'alice', auth_time: 0 }) }
    await authenticate(auth, 'Bearer a', { limiter })
    await authenticate(auth, 'Bearer a', { limiter })
    await assert.rejects(authenticate(auth, 'Bearer a', { limiter }), { code: 'rate-limited' })
    // An invalid token never counts against the account.
    const bad = { verifyIdToken: async () => Promise.reject(new Error('bad')) }
    clearUidLimiters()
    await assert.rejects(authenticate(bad, 'Bearer x', { limiter }), { code: 'unauthenticated' })
    await authenticate(auth, 'Bearer a', { limiter })
    await authenticate(auth, 'Bearer a', { limiter })
  })
})

describe('cost guard', () => {
  function fakeDb(data, { fail = false } = {}) {
    const db = {
      reads: 0,
      data,
      collection(name) {
        assert.equal(name, 'systemFlags')
        return {
          doc(id) {
            assert.equal(id, 'costGuard')
            return {
              async get() {
                db.reads += 1
                if (fail) throw new Error('Firestore unavailable')
                return { data: () => db.data }
              },
            }
          },
        }
      },
    }
    return db
  }

  test('follows the budget unless the owner pinned it', () => {
    assert.equal(guardEngaged(undefined), false)
    assert.equal(guardEngaged({ engaged: true }), true)
    assert.equal(guardEngaged({ engaged: true, override: 'released' }), false)
    assert.equal(guardEngaged({ engaged: false, override: 'engaged' }), true)
    assert.equal(guardEngaged({ engaged: true, override: 'auto' }), true)
  })

  test('a guard the budget engaged ends at the next budget period (H2)', () => {
    const until = new Date('2026-12-01T07:00:00Z')
    const state = { engaged: true, reason: 'budget', engagedUntil: until }
    assert.equal(guardEngaged(state, until.getTime() - 1), true)
    assert.equal(guardEngaged(state, until.getTime()), false)
    // A Firestore Timestamp works the same.
    const stamp = { ...state, engagedUntil: { toMillis: () => until.getTime() } }
    assert.equal(guardEngaged(stamp, until.getTime()), false)
    // The owner's pin and a guard engaged by hand do not expire.
    assert.equal(guardEngaged({ ...state, override: 'engaged' }, until.getTime() + 1), true)
    assert.equal(guardEngaged({ ...state, reason: 'manual' }, until.getTime() + 1), true)
    assert.equal(nextBudgetPeriodStart('2026-11-01T07:00:00Z').toISOString(), until.toISOString())
    assert.equal(nextBudgetPeriodStart('not a date'), null)
  })

  test('only the owner pin, never the budget, pauses the scheduled Pro alerts (H2)', async () => {
    const { pinnedByOwner } = require('../lib/shared/cost-guard')
    assert.equal(pinnedByOwner({ engaged: true, reason: 'budget' }), false)
    assert.equal(pinnedByOwner({ override: 'engaged' }), true)
    assert.equal(pinnedByOwner(undefined), false)
    const guard = new CostGuard(fakeDb({ engaged: true, reason: 'budget' }))
    assert.equal(await guard.engaged(), true)
    assert.equal(await guard.pinnedByOwner(), false)
    const source = require('node:fs').readFileSync(
      require.resolve('../lib/notifications/functions.js'),
      'utf8',
    )
    assert.doesNotMatch(source, /costGuard\.engaged/)
    assert.match(source, /costGuard\.pinnedByOwner/)
  })

  test('reads the switch at most once a minute per instance', async () => {
    let now = 0
    const db = fakeDb({ engaged: true })
    const guard = new CostGuard(db, () => now)
    await Promise.all([guard.engaged(), guard.engaged(), guard.engaged()])
    assert.equal(db.reads, 1)
    db.data = { engaged: false }
    now = 59_000
    assert.equal(await guard.engaged(), true)
    now = 60_000
    assert.equal(await guard.engaged(), false)
    assert.equal(db.reads, 2)
  })

  test('keeps the paths on when the switch cannot be read', async () => {
    const guard = new CostGuard(fakeDb(undefined, { fail: true }))
    assert.equal(await guard.engaged(), false)
    assert.ok(logs.entries.some(entry => entry.message?.includes('cost guard could not be read')))
  })

  test('pauses the calendar feed with a retry hint and no account lookup', async () => {
    let lookups = 0
    const handler = createCalendarFeedHandler({
      buildICS: () => '',
      buildSunEvents: () => [],
      costGuard: { engaged: async () => true },
      db: {
        collection() {
          lookups += 1
          throw new Error('not reached')
        },
      },
      fetchForecast: async () => [],
    })
    const res = responseRecorder()
    await handler({ method: 'GET', query: { token: 'A'.repeat(43) }, headers: {} }, res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['Retry-After'], '3600')
    assert.equal(lookups, 0)
  })
})

describe('budget kill switch', () => {
  test('reads a Cloud Billing budget notification and nothing else', () => {
    const sample = {
      budgetDisplayName: 'Solara',
      alertThresholdExceeded: 1.0,
      costAmount: 5.12,
      costIntervalStart: '2026-11-01T07:00:00Z',
      budgetAmount: 5,
      budgetAmountType: 'SPECIFIED_AMOUNT',
      currencyCode: 'USD',
    }
    assert.deepEqual(parseBudgetNotification(sample), {
      budgetDisplayName: 'Solara',
      costAmount: 5.12,
      budgetAmount: 5,
      costIntervalStart: '2026-11-01T07:00:00Z',
      currencyCode: 'USD',
    })
    assert.equal(parseBudgetNotification(null), null)
    assert.equal(parseBudgetNotification({ ...sample, budgetAmount: 0 }), null)
    assert.equal(parseBudgetNotification({ ...sample, costAmount: '5' }), null)
    assert.equal(parseBudgetNotification({ ...sample, costIntervalStart: undefined }), null)
  })

  test('acts only on the budget BUDGET_ID names (L2)', () => {
    const attributes = { billingAccountId: '01D4EE-079462-DFD6EC', budgetId: 'de72f49d-779b' }
    assert.equal(fromExpectedBudget(attributes, 'de72f49d-779b'), true)
    assert.equal(
      fromExpectedBudget(attributes, 'billingAccounts/01D4EE-079462-DFD6EC/budgets/de72f49d-779b'),
      true,
    )
    assert.equal(fromExpectedBudget({ ...attributes, budgetId: 'other' }, 'de72f49d-779b'), false)
    assert.equal(fromExpectedBudget(undefined, 'de72f49d-779b'), false)
    // Unset: every budget, as before the param existed.
    assert.equal(fromExpectedBudget(undefined, ''), true)
  })

  test('runs as its own identity when BUDGET_SERVICE_ACCOUNT names one (L2)', () => {
    assert.equal(budgetServiceAccount({}), undefined)
    assert.equal(budgetServiceAccount({ BUDGET_SERVICE_ACCOUNT: '  ' }), undefined)
    assert.equal(
      budgetServiceAccount({ BUDGET_SERVICE_ACCOUNT: 'solara-budget@p.iam.gserviceaccount.com' }),
      'solara-budget@p.iam.gserviceaccount.com',
    )
  })

  test('detaches billing with one PUT that removes the billing account', async () => {
    const calls = []
    const disable = cloudBillingDisabler(
      async () => 'access-token',
      async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200 }
      },
    )
    await disable('uv-activity-planner')
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].url,
      'https://cloudbilling.googleapis.com/v1/projects/uv-activity-planner/billingInfo',
    )
    assert.equal(calls[0].init.method, 'PUT')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer access-token')
    assert.deepEqual(JSON.parse(calls[0].init.body), { billingAccountName: '' })
    await assert.rejects(disable('../other'), /Invalid project id/)
    const failing = cloudBillingDisabler(
      async () => 'token',
      async () => ({ ok: false, status: 403 }),
    )
    await assert.rejects(failing('uv-activity-planner'), /Cloud Billing answered 403/)
  })
})

describe('maintenance run', () => {
  test('runs every task even when one fails, then reports the failure', async () => {
    const ran = []
    await assert.rejects(
      runMaintenance([
        { name: 'first', run: async () => ran.push('first') },
        {
          name: 'broken',
          run: async () => {
            throw new Error('Stripe is down')
          },
        },
        { name: 'last', run: async () => ran.push('last') },
      ]),
      error => error instanceof AggregateError && error.errors.length === 1,
    )
    assert.deepEqual(ran, ['first', 'last'])
    assert.ok(
      logs.entries.some(
        entry => entry.severity === 'ERROR' && entry.message === 'maintenance task broken failed',
      ),
    )
  })

  test('returns each task outcome when all succeed', async () => {
    const outcomes = await runMaintenance([{ name: 'only', run: async () => 7 }])
    assert.deepEqual(outcomes, [{ name: 'only', ok: true, result: 7 }])
  })
})
