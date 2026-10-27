const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { verifyAppCheck } = require('../lib/shared/app-check')
const { ERROR_CODES, HttpError, publicError } = require('../lib/shared/errors')
const { clientAddress, createApiHandler, TRUSTED_PROXY_HOPS } = require('../lib/shared/http')
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
          },
        ],
        [
          'ERROR',
          'testEndpoint failed',
          {
            function: 'testEndpoint',
            status: 500,
            error: { name: 'Error', message: 'internal path /srv/secret' },
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

describe('deployed entry point', () => {
  test('loads from package.json main and protects every browser endpoint', async () => {
    process.env.GCLOUD_PROJECT ??= 'demo-solara'
    process.env.APP_URL = 'https://solara-uv.web.app'
    // The package entry point, exactly what `firebase deploy` loads.
    const functions = require('..')
    assert.equal(require.resolve('..'), require.resolve('../lib/index.js'))
    assert.deepEqual(Object.keys(functions).sort(), [
      'budgetAlert',
      'calendarFeed',
      'createBillingPortalSession',
      'createCheckoutSession',
      'deleteAccount',
      'exportAccountData',
      'forecast',
      'maintenance',
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

  test('falls back to the socket address without the header', () => {
    assert.equal(clientAddress(req(undefined)), '10.0.0.1')
    assert.equal(clientAddress(req('')), '10.0.0.1')
    assert.equal(clientAddress({ headers: {} }), 'unknown')
  })
})
