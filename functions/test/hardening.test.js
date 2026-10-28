// Cost and abuse hardening for the Blaze plan: runtime ceilings on every function, App
// Check on every browser endpoint, per-address, per-account and body size limits, the
// cost guard, the budget kill switch's parsing and the maintenance run.
const { afterEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { authenticate, clearUidLimiters, uidLimiter } = require('../lib/shared/auth')
const { CostGuard, guardEngaged } = require('../lib/shared/cost-guard')
const { createApiHandler } = require('../lib/shared/http')
const { cloudBillingDisabler, parseBudgetNotification } = require('../lib/ops/budget')
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

  test('background functions run one small instance and are not retried', () => {
    const { budgetAlert, maintenance } = functions
    assert.equal(maintenance.__endpoint.maxInstances, 1)
    assert.equal(maintenance.__endpoint.cpu, 'gcf_gen1')
    assert.equal(maintenance.__endpoint.scheduleTrigger.retryConfig.retryCount, 0)
    assert.equal(budgetAlert.__endpoint.maxInstances, 1)
    assert.equal(budgetAlert.__endpoint.eventTrigger.retry, false)
    assert.equal(budgetAlert.__endpoint.eventTrigger.eventFilters.topic, 'budget-alerts')
  })

  test("stays within Cloud Scheduler's three free jobs: maintenance and alerts", () => {
    const scheduled = Object.entries(functions).filter(([, fn]) => fn.__endpoint.scheduleTrigger)
    assert.deepEqual(scheduled.map(([name]) => name).sort(), ['alerts', 'maintenance'])
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
    const guard = {
      assertAllowed: async () => {
        throw new (require('../lib/shared/errors').HttpError)(
          'unavailable',
          'This feature is paused. Try again later.',
        )
      },
    }
    const handle = endpoint({ costFeature: 'forecast', costGuard: () => guard })
    const res = responseRecorder()
    await handle(post(), res)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'unavailable')
    assert.throws(() => endpoint({ costFeature: 'forecast' }), /needs a costGuard/)
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

  test('reads the switch at most once a minute per instance', async () => {
    let now = 0
    const db = fakeDb({ engaged: true })
    const guard = new CostGuard(db, () => now)
    await Promise.all([guard.engaged(), guard.engaged(), guard.engaged()])
    assert.equal(db.reads, 1)
    await assert.rejects(guard.assertAllowed('forecast'), { code: 'unavailable', status: 503 })
    db.data = { engaged: false }
    now = 59_000
    assert.equal(await guard.engaged(), true)
    now = 60_000
    assert.equal(await guard.engaged(), false)
    assert.equal(db.reads, 2)
  })

  test('keeps the paths on when the switch cannot be read', async () => {
    const guard = new CostGuard(fakeDb(undefined, { fail: true }))
    await guard.assertAllowed('forecast')
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
