const { HttpError, loggableError, publicError } = require('./errors')

/**
 * @typedef {import('firebase-functions/v2/https').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('firebase-admin/app-check').AppCheck} AppCheck
 * @typedef {'GET' | 'POST' | 'DELETE'} ApiMethod
 * @typedef {'standard' | 'limited-use'} AppCheckMode
 */

/**
 * @param {Request} req
 * @param {Response} res
 * @param {string} allowedOrigin
 * @param {string[]} methods
 * @returns {boolean} true when the request was fully answered here
 */
function handleCors(req, res, allowedOrigin, methods) {
  const origin = req.headers.origin
  if (origin === allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin)
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck')
    res.set('Access-Control-Allow-Methods', methods.join(', '))
    res.set('Access-Control-Max-Age', '3600')
    res.status(origin && origin !== allowedOrigin ? 403 : 204).send('')
    return true
  }
  if (origin && origin !== allowedOrigin) {
    const { status, body } = publicError(
      new HttpError('origin-not-allowed', 'Origin not allowed'),
      'Origin not allowed',
    )
    res.status(status).json(body)
    return true
  }
  return false
}

/** @param {Response} res */
function setApiHeaders(res) {
  res.set('Cache-Control', 'no-store')
  res.set('Content-Type', 'application/json; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
}

/**
 * Verifies the Firebase App Check token a browser sends in `X-Firebase-AppCheck`.
 *
 * In `limited-use` mode the token is consumed, so a captured token cannot be replayed:
 * the browser must mint a fresh limited-use token for every sensitive request.
 *
 * @param {AppCheck} appCheck
 * @param {unknown} token
 * @param {AppCheckMode} mode
 */
async function verifyAppCheck(appCheck, token, mode) {
  if (typeof token !== 'string' || !token) {
    throw new HttpError('app-check-required', 'App verification required')
  }
  let result
  try {
    result =
      mode === 'limited-use'
        ? await appCheck.verifyToken(token, { consume: true })
        : await appCheck.verifyToken(token)
  } catch (error) {
    throw new HttpError('app-check-required', 'App verification required', { cause: error })
  }
  if (mode === 'limited-use' && result.alreadyConsumed !== false) {
    throw new HttpError('app-check-required', 'App verification required')
  }
  return result
}

/**
 * One request pipeline for every browser-called endpoint: security headers, an exact-origin
 * CORS check, a single method, App Check (with replay protection where requested), then the
 * handler. Errors become an allowlisted `{ error, code }` body; nothing else is echoed.
 *
 * @template T
 * @param {{
 *   name: string,
 *   method: ApiMethod,
 *   allowedOrigin: () => string,
 *   appCheck: () => AppCheck,
 *   appCheckMode: AppCheckMode,
 *   fallbackMessage: string,
 *   handler: (req: Request) => Promise<{ status?: number, body: T }>,
 * }} options
 * @returns {(req: Request, res: Response) => Promise<void>}
 */
function createApiHandler({
  name,
  method,
  allowedOrigin,
  appCheck,
  appCheckMode,
  fallbackMessage,
  handler,
}) {
  return async (req, res) => {
    setApiHeaders(res)
    if (handleCors(req, res, allowedOrigin(), [method])) return
    if (req.method !== method) {
      res.set('Allow', method)
      const { status, body } = publicError(
        new HttpError('method-not-allowed', 'Method Not Allowed'),
        fallbackMessage,
      )
      res.status(status).json(body)
      return
    }
    try {
      await verifyAppCheck(appCheck(), req.headers['x-firebase-appcheck'], appCheckMode)
      const result = await handler(req)
      res.status(result.status ?? 200).json(result.body)
    } catch (error) {
      const { status, body } = publicError(error, fallbackMessage)
      const log = status >= 500 ? console.error : console.warn
      log(`${name} failed`, loggableError(error))
      res.status(status).json(body)
    }
  }
}

/**
 * The client address for coarse abuse limits. Cloud Run sets X-Forwarded-For; the first
 * entry is the original client.
 *
 * @param {Request} req
 */
function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.ip || 'unknown'
}

module.exports = { clientAddress, createApiHandler, handleCors, setApiHeaders, verifyAppCheck }
