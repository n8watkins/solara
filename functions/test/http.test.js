const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { verifyAppCheck } = require('../lib/shared/app-check')
const { ERROR_CODES, HttpError, publicError } = require('../lib/shared/errors')
const { clientAddress, createApiHandler, TRUSTED_PROXY_HOPS } = require('../lib/shared/http')
const { ProxyHopMonitor, isProxyOrPrivateAddress } = require('../lib/shared/client-address')
const { FixedWindowLimiter } = require('../lib/shared/rate-limit')
const { captureLogs } = require('./support/logs')

const ORIGIN = 'https://app.example.com'

// Rejections are logged by design; capture them to keep the output readable and checkable.
const logs = captureLogs()

function responseRecorder() {
  return {
    headers: /** @type {Record<string, string>} */ ({}),
    statusCode: 200,
    /** @type {unknown} */
    body: undefined,
    /** @param {string} name @param {string} value */
    set(name, value) {
      this.headers[name] = value
      return this
    },
    /** @param {number} code */
    status(code) {
      this.statusCode = code
      return this
    },
    /** @param {unknown} body */
    send(body) {
      this.body = body
      return this
    },
    /** @param {unknown} body */
    json(body) {
      this.body = body
      return this
    },
  }
}

function appCheckStub({ alreadyConsumed = false, valid = true } = {}) {
  const calls = []
  return {
    calls,
    async verifyToken(token, options) {
      calls.push({ token, options })
      if (!valid) throw new Error('invalid app check token')
      return {
        appId: 'app',
        token: {},
        ...(options?.consume ? { alreadyConsumed } : {}),
      }
    },
  }
}

function api({ appCheck = appCheckStub(), appCheckMode = 'standard', handler } = {}) {
  const calls = []
  return {
    appCheck,
    calls,
    handle: createApiHandler({
      name: 'testEndpoint',
      method: 'POST',
      allowedOrigin: () => ORIGIN,
      appCheck: () => appCheck,
      appCheckMode,
      fallbackMessage: 'Service unavailable',
      handler:
        handler ??
        (async req => {
          calls.push(req)
          return { body: { ok: true } }
        }),
    }),
  }
}

function post(headers = {}) {
  return {
    method: 'POST',
    headers: { origin: ORIGIN, 'x-firebase-appcheck': 'app-check-token', ...headers },
    body: {},
  }
}

describe('allowlisted errors', () => {
  test('only allowlisted codes can be constructed, and each fixes its status', () => {
    assert.throws(() => new HttpError(/** @type {any} */ ('teapot'), 'nope'), TypeError)
    const error = new HttpError('rate-limited', 'Slow down')
    assert.equal(error.status, 429)
    assert.equal(error.code, 'rate-limited')
    assert.equal(ERROR_CODES['deletion-in-progress'], 409)
  })

  test('never reflects the message of an unexpected error', () => {
    const leaked = publicError(new Error('Stripe key sk_live_123 rejected'), 'Checkout unavailable')
    assert.deepEqual(leaked, {
      status: 500,
      body: { error: 'Checkout unavailable', code: 'internal' },
    })
    const typed = publicError(new HttpError('conflict', 'Already subscribed'), 'unused')
    assert.deepEqual(typed, {
      status: 409,
      body: { error: 'Already subscribed', code: 'conflict' },
    })
  })
})

describe('browser API pipeline', () => {
  test('requires an App Check token before running the handler', async () => {
    const { calls, handle } = api()
    const res = responseRecorder()
    await handle(post({ 'x-firebase-appcheck': undefined }), res)
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, { error: 'App verification required', code: 'app-check-required' })
    assert.equal(calls.length, 0)
  })

  test('rejects an App Check token that does not verify', async () => {
    const { calls, handle } = api({ appCheck: appCheckStub({ valid: false }) })
    const res = responseRecorder()
    await handle(post(), res)
    assert.equal(res.statusCode, 401)
    assert.equal(calls.length, 0)
  })

  test('verifies a standard token without consuming it', async () => {
    const { appCheck, calls, handle } = api()
    const res = responseRecorder()
    await handle(post(), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { ok: true })
    assert.equal(calls.length, 1)
    assert.deepEqual(appCheck.calls, [{ token: 'app-check-token', options: undefined }])
    assert.equal(res.headers['Cache-Control'], 'no-store')
  })

  test('consumes limited-use tokens and refuses a replay', async () => {
    const fresh = api({ appCheckMode: 'limited-use' })
    const first = responseRecorder()
    await fresh.handle(post(), first)
    assert.equal(first.statusCode, 200)
    assert.deepEqual(fresh.appCheck.calls[0].options, { consume: true })

    const replay = api({
      appCheckMode: 'limited-use',
      appCheck: appCheckStub({ alreadyConsumed: true }),
    })
    const second = responseRecorder()
    await replay.handle(post(), second)
    assert.equal(second.statusCode, 401)
    assert.equal(replay.calls.length, 0)
  })

  test('verifyAppCheck treats a missing replay verdict as a replay', async () => {
    const appCheck = { verifyToken: async () => ({ appId: 'app', token: {} }) }
    await assert.rejects(
      verifyAppCheck(/** @type {any} */ (appCheck), 'token', 'limited-use'),
      error => error instanceof HttpError && error.code === 'app-check-required',
    )
  })

  test('maps typed errors to their code and hides everything else', async () => {
    const typed = api({
      handler: async () => {
        throw new HttpError('conflict', 'Checkout is already in progress')
      },
    })
    const res = responseRecorder()
    await typed.handle(post(), res)
    assert.equal(res.statusCode, 409)
    assert.deepEqual(res.body, { error: 'Checkout is already in progress', code: 'conflict' })

    const crashing = api({
      handler: async () => {
        throw new Error('internal path /srv/secret')
      },
    })
    const hidden = responseRecorder()
    await crashing.handle(post(), hidden)
    assert.equal(hidden.statusCode, 500)
    assert.deepEqual(hidden.body, { error: 'Service unavailable', code: 'internal' })

    // A 4xx is a warning and a 5xx an error, each with structured fields.
    assert.deepEqual(
      logs.entries.map(({ severity, message, fields }) => [severity, message, fields]),
      [
        [
          'WARNING',
          'testEndpoint rejected',
          {
            function: 'testEndpoint',
            status: 409,
            error: {
              name: 'HttpError',
              code: 'conflict',
              message: 'Checkout is already in progress',
            },
            suppressed: 0,
          },
        ],
        [
          'ERROR',
          'testEndpoint failed',
          {
            function: 'testEndpoint',
            status: 500,
            error: { name: 'Error', message: 'internal path /srv/secret' },
            suppressed: 0,
          },
        ],
      ],
    )
  })

  test('rejects other methods and foreign origins before App Check', async () => {
    const { appCheck, handle } = api()
    const wrongMethod = responseRecorder()
    await handle({ ...post(), method: 'GET' }, wrongMethod)
    assert.equal(wrongMethod.statusCode, 405)
    assert.equal(wrongMethod.headers.Allow, 'POST')

    const foreign = responseRecorder()
    await handle(post({ origin: 'https://attacker.example' }), foreign)
    assert.equal(foreign.statusCode, 403)
    assert.deepEqual(foreign.body, { error: 'Origin not allowed', code: 'origin-not-allowed' })
    assert.equal(appCheck.calls.length, 0)
  })
})

describe('cheap rejections', () => {
  test('logs one line a minute per kind of rejection, not one per request', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-27T14:00:00Z') })
    const { handle } = api()
    // 50 stays under the per-address limit, so every one is the same kind of rejection.
    for (let i = 0; i < 50; i += 1) {
      await handle(post({ 'x-firebase-appcheck': undefined }), responseRecorder())
    }
    const rejected = () => logs.entries.filter(entry => entry.message === 'testEndpoint rejected')
    assert.equal(rejected().length, 1)
    assert.equal(rejected()[0].fields.suppressed, 0)
    assert.equal(rejected()[0].fields.status, 401)
    t.mock.timers.tick(60_000)
    await handle(post({ 'x-firebase-appcheck': undefined }), responseRecorder())
    assert.equal(rejected().length, 2)
    assert.equal(rejected()[1].fields.suppressed, 49)
  })

  test('answers 503 while the cost guard is engaged, before verifying App Check', async () => {
    const appCheck = appCheckStub()
    let checks = 0
    const guard = {
      engaged: async () => {
        checks += 1
        return true
      },
    }
    const handle = createApiHandler({
      name: 'guarded',
      method: 'POST',
      allowedOrigin: () => ORIGIN,
      appCheck: () => appCheck,
      appCheckMode: 'standard',
      costFeature: 'notifications',
      costGuard: () => guard,
      fallbackMessage: 'Service unavailable',
      handler: async () => ({ body: { ok: true } }),
    })
    for (let i = 0; i < 50; i += 1) {
      const res = responseRecorder()
      await handle(post(), res)
      assert.equal(res.statusCode, 503)
      assert.equal(res.body.code, 'unavailable')
    }
    assert.equal(appCheck.calls.length, 0)
    assert.equal(checks, 50)
    // No ERROR per request: the budget kill switch already alerted the owner.
    assert.equal(logs.entries.filter(entry => entry.severity === 'ERROR').length, 0)
    assert.equal(logs.entries.length, 1)
  })

  test('a request without an App Check token never reaches the cost guard', async () => {
    let checks = 0
    const handle = createApiHandler({
      name: 'guarded',
      method: 'POST',
      allowedOrigin: () => ORIGIN,
      appCheck: () => appCheckStub(),
      appCheckMode: 'standard',
      costFeature: 'notifications',
      costGuard: () => ({
        engaged: async () => {
          checks += 1
          return false
        },
      }),
      fallbackMessage: 'Service unavailable',
      handler: async () => ({ body: { ok: true } }),
    })
    const res = responseRecorder()
    await handle(post({ 'x-firebase-appcheck': undefined }), res)
    assert.equal(res.statusCode, 401)
    assert.equal(checks, 0)
  })
})

describe('deployed entry point', () => {
  test('loads from package.json main and protects every browser endpoint', async () => {
    process.env.GCLOUD_PROJECT ??= 'demo-solara'
    process.env.APP_URL = 'https://solara-uv.web.app'
    // The package entry point, exactly what `firebase deploy` loads.
    const functions = require('..')
    assert.equal(require.resolve('..'), require.resolve('../lib/index.js'))
    assert.deepEqual(Object.keys(functions).sort(), [
      'alerts',
      'budgetAlert',
      'calendarFeed',
      'createBillingPortalSession',
      'createCheckoutSession',
      'deleteAccount',
      'exportAccountData',
      'forecast',
      'maintenance',
      'placeSearch',
      'registerNotificationDevice',
      'removeNotificationDevice',
      'revokeCalendarFeed',
      'rotateCalendarFeed',
      'stripeWebhook',
    ])
    const browserEndpoints = {
      createCheckoutSession: 'POST',
      createBillingPortalSession: 'POST',
      exportAccountData: 'GET',
      deleteAccount: 'DELETE',
      registerNotificationDevice: 'POST',
      removeNotificationDevice: 'DELETE',
      rotateCalendarFeed: 'POST',
      revokeCalendarFeed: 'DELETE',
      forecast: 'GET',
      placeSearch: 'GET',
    }
    for (const [name, method] of Object.entries(browserEndpoints)) {
      const res = responseRecorder()
      await functions[name](
        { method, headers: { origin: 'https://solara-uv.web.app' }, body: {} },
        res,
      )
      assert.equal(res.statusCode, 401, name)
      assert.deepEqual(
        res.body,
        { error: 'App verification required', code: 'app-check-required' },
        name,
      )
      // Wrong method and foreign origin are refused before App Check, as before.
      const wrongMethod = responseRecorder()
      await functions[name](
        { method: 'PUT', headers: { origin: 'https://solara-uv.web.app' }, body: {} },
        wrongMethod,
      )
      assert.equal(wrongMethod.statusCode, 405, name)
      assert.equal(wrongMethod.headers.Allow, method, name)
    }
    assert.equal(typeof functions.calendarFeed, 'function')
    assert.equal(typeof functions.stripeWebhook, 'function')
  })
})

describe('fixed-window limiter', () => {
  test('allows the budget, then blocks until the window resets', () => {
    const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1000 })
    assert.equal(limiter.take('a', 0).allowed, true)
    assert.equal(limiter.take('a', 1).allowed, true)
    assert.equal(limiter.exhausted('a', 2), true)
    assert.deepEqual(limiter.take('a', 2), { allowed: false, retryAfterSeconds: 1 })
    assert.equal(limiter.take('b', 2).allowed, true)
    assert.equal(limiter.take('a', 1000).allowed, true)
  })

  test('keeps memory bounded by evicting the oldest key', () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 })
    limiter.take('a', 0)
    limiter.take('b', 0)
    limiter.take('c', 0)
    assert.equal(limiter.windows.size, 2)
    assert.equal(limiter.windows.has('a'), false)
  })
})

describe('clientAddress', () => {
  const req = (forwarded, remoteAddress = '10.0.0.1') => ({
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    socket: { remoteAddress },
  })

  test('trusts only the entry Google appended', () => {
    assert.equal(TRUSTED_PROXY_HOPS, 1)
    assert.equal(clientAddress(req('203.0.113.9')), '203.0.113.9')
    assert.equal(clientAddress(req('1.2.3.4, 5.6.7.8,203.0.113.9')), '203.0.113.9')
    assert.equal(clientAddress(req(['1.2.3.4', '203.0.113.9'])), '203.0.113.9')
  })

  test('counts hops from the right when a load balancer adds its own entry', () => {
    assert.equal(clientAddress(req('1.2.3.4, 203.0.113.9, 34.1.1.1'), 2), '203.0.113.9')
    // Fewer entries than hops: nothing trustworthy in the header.
    assert.equal(clientAddress(req('203.0.113.9'), 2), '10.0.0.1')
  })

  test('buckets IPv6 clients by their /64, so one connection gets one budget', () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 })
    const keys = new Set()
    let allowed = 0
    for (let i = 1; i <= 50; i += 1) {
      const key = clientAddress(req(`2001:db8:1:2::${i.toString(16)}`))
      keys.add(key)
      if (limiter.take(key).allowed) allowed += 1
    }
    assert.deepEqual([...keys], ['2001:db8:1:2::/64'])
    assert.equal(allowed, 1)
    assert.equal(clientAddress(req('2001:0db8:0001:0002:ffff:1:2:3')), '2001:db8:1:2::/64')
    assert.equal(clientAddress(req('2001:db8:1:3::1')), '2001:db8:1:3::/64')
    assert.equal(clientAddress(req('::1')), '0:0:0:0::/64')
    assert.equal(clientAddress(req('2001:db8::')), '2001:db8:0:0::/64')
  })

  test('counts an IPv4-mapped IPv6 address as the IPv4 address', () => {
    assert.equal(clientAddress(req('::ffff:203.0.113.9')), '203.0.113.9')
    assert.equal(clientAddress(req('::ffff:cb00:7109')), '203.0.113.9')
    assert.equal(clientAddress(req(undefined, '::ffff:198.51.100.2')), '198.51.100.2')
  })

  test('leaves anything that is not an address as it is', () => {
    assert.equal(clientAddress(req('not-an-address')), 'not-an-address')
    assert.equal(clientAddress(req('1.2.3.4.5')), '1.2.3.4.5')
  })

  test('falls back to the socket address without the header', () => {
    assert.equal(clientAddress(req(undefined)), '10.0.0.1')
    assert.equal(clientAddress(req('')), '10.0.0.1')
    assert.equal(clientAddress({ headers: {} }), 'unknown')
  })
})

describe('proxy hop self-check', () => {
  const req = forwarded => ({ headers: { 'x-forwarded-for': forwarded } })

  test('raises one ERROR when most requests seem to come from Google proxies', () => {
    const monitor = new ProxyHopMonitor('forecast', { sampleSize: 20 })
    for (let i = 0; i < 100; i += 1)
      monitor.observe(req(`198.51.100.${i % 200}, 35.191.4.${i % 250}`))
    const errors = logs.entries.filter(entry => entry.severity === 'ERROR')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].message, 'client address is a proxy address: check TRUSTED_PROXY_HOPS')
    assert.deepEqual(errors[0].fields.forwardedEntryCounts, { 2: 20 })
    // Never an address in the log.
    assert.doesNotMatch(JSON.stringify(logs.entries), /198\.51|35\.191/)
    const check = logs.entries.find(entry => entry.message === 'client address check')
    assert.deepEqual(check.fields, {
      function: 'forecast',
      forwardedEntries: 2,
      trustedHops: 1,
      kind: 'not-a-client',
    })
  })

  test('stays quiet for real client addresses and for local requests', () => {
    const monitor = new ProxyHopMonitor('forecast', { sampleSize: 20 })
    for (let i = 0; i < 100; i += 1) monitor.observe(req(`1.2.3.4, 203.0.113.${i % 200}`))
    for (let i = 0; i < 100; i += 1) monitor.observe({ headers: {} })
    assert.equal(logs.entries.filter(entry => entry.severity === 'ERROR').length, 0)
    assert.equal(logs.entries.filter(entry => entry.message === 'client address check').length, 1)
  })

  test('knows the ranges no client connects from', () => {
    for (const address of [
      '35.191.0.1',
      '130.211.3.255',
      '10.1.2.3',
      '172.31.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '127.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '2600:2d00:1:b029::1',
    ]) {
      assert.equal(isProxyOrPrivateAddress(address), true, address)
    }
    for (const address of [
      '203.0.113.9',
      '130.211.4.0',
      '8.8.8.8',
      '2001:db8::1',
      '2600:1700::1',
    ]) {
      assert.equal(isProxyOrPrivateAddress(address), false, address)
    }
  })
})
