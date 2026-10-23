const { after, before, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { ERROR_CODES, HttpError, publicError } = require('../lib/errors')
const { createApiHandler, verifyAppCheck } = require('../lib/http')
const { FixedWindowLimiter } = require('../lib/rate-limit')

const ORIGIN = 'https://app.example.com'

// Rejections are logged as warnings by design; keep the test output readable.
const originalWarn = console.warn
before(() => {
  console.warn = () => {}
})
after(() => {
  console.warn = originalWarn
})

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
    const originalError = console.error
    console.error = () => {}
    try {
      await crashing.handle(post(), hidden)
    } finally {
      console.error = originalError
    }
    assert.equal(hidden.statusCode, 500)
    assert.deepEqual(hidden.body, { error: 'Service unavailable', code: 'internal' })
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
  test('loads with the modular Admin SDK and protects every browser endpoint', async () => {
    process.env.GCLOUD_PROJECT ??= 'demo-solara'
    process.env.APP_URL = 'https://uv-activity-planner.web.app'
    const functions = require('../index.js')
    const browserEndpoints = {
      createCheckoutSession: 'POST',
      createBillingPortalSession: 'POST',
      exportAccountData: 'GET',
      deleteAccount: 'DELETE',
      registerNotificationDevice: 'POST',
      removeNotificationDevice: 'DELETE',
      rotateCalendarFeed: 'POST',
      revokeCalendarFeed: 'DELETE',
    }
    for (const [name, method] of Object.entries(browserEndpoints)) {
      const res = responseRecorder()
      await functions[name](
        { method, headers: { origin: 'https://uv-activity-planner.web.app' }, body: {} },
        res,
      )
      assert.equal(res.statusCode, 401, name)
      assert.deepEqual(
        res.body,
        { error: 'App verification required', code: 'app-check-required' },
        name,
      )
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
