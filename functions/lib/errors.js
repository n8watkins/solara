// Errors that may cross the HTTP boundary.
//
// Only an HttpError is ever reflected to a browser, and only through its fixed public
// message and an allowlisted machine-readable code. Every other error (Stripe, Firestore,
// programming bugs) becomes a generic per-endpoint message so internal details never leak.

/** Machine-readable codes a browser may receive, mapped to their HTTP status. */
const ERROR_CODES = Object.freeze({
  'invalid-argument': 400,
  unauthenticated: 401,
  'reauth-required': 401,
  'app-check-required': 401,
  'permission-denied': 403,
  'origin-not-allowed': 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  'deletion-in-progress': 409,
  'rate-limited': 429,
  internal: 500,
  unavailable: 503,
})

/** @typedef {keyof typeof ERROR_CODES} ErrorCode */

class HttpError extends Error {
  /**
   * @param {ErrorCode} code Allowlisted code; it also fixes the HTTP status.
   * @param {string} message Public, user-safe message. Never interpolate internal data.
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options)
    if (!Object.hasOwn(ERROR_CODES, code)) throw new TypeError(`Unknown error code: ${code}`)
    this.name = 'HttpError'
    /** @type {ErrorCode} */
    this.code = code
    /** @type {number} */
    this.status = ERROR_CODES[code]
  }
}

/**
 * The status and JSON body a browser receives for any thrown value.
 *
 * @param {unknown} error
 * @param {string} fallbackMessage Generic message for anything that is not an HttpError.
 * @returns {{ status: number, body: { error: string, code: ErrorCode } }}
 */
function publicError(error, fallbackMessage) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return { status: 500, body: { error: fallbackMessage, code: 'internal' } }
}

/**
 * Fields that are safe to log for any error. Messages from third parties can include
 * identifiers, so only HttpError messages (which are authored here) are logged verbatim.
 *
 * @param {unknown} error
 */
function loggableError(error) {
  if (error instanceof HttpError) {
    return { name: error.name, code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    const code = /** @type {{ code?: unknown }} */ (error).code
    return {
      name: error.name,
      code: typeof code === 'string' || typeof code === 'number' ? code : undefined,
      message: error.message,
    }
  }
  return { name: typeof error }
}

/**
 * The `code` of an SDK error (Stripe, Firebase Admin), or undefined.
 *
 * @param {unknown} error
 * @returns {unknown}
 */
function errorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/**
 * A thrown value's message for server-side records, with a fallback.
 *
 * @param {unknown} error
 * @param {string} fallback
 */
function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

module.exports = { ERROR_CODES, HttpError, errorCode, errorMessage, loggableError, publicError }
