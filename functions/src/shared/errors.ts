// Errors that may cross the HTTP boundary.
//
// Only an HttpError is ever reflected to a browser, and only through its fixed public
// message and an allowlisted machine-readable code. Every other error (Stripe, Firestore,
// programming bugs) becomes a generic per-endpoint message so internal details never leak.

import { redact } from './logging'

/** Machine-readable codes a browser may receive, mapped to their HTTP status. */
export const ERROR_CODES = Object.freeze({
  'invalid-argument': 400,
  unauthenticated: 401,
  'reauth-required': 401,
  'app-check-required': 401,
  'permission-denied': 403,
  'origin-not-allowed': 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  'payload-too-large': 413,
  'deletion-in-progress': 409,
  'rate-limited': 429,
  internal: 500,
  unavailable: 503,
})

export type ErrorCode = keyof typeof ERROR_CODES

export class HttpError extends Error {
  readonly code: ErrorCode
  readonly status: number

  /**
   * @param code Allowlisted code; it also fixes the HTTP status.
   * @param message Public, user-safe message. Never interpolate internal data.
   */
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    if (!Object.hasOwn(ERROR_CODES, code)) throw new TypeError(`Unknown error code: ${code}`)
    this.name = 'HttpError'
    this.code = code
    this.status = ERROR_CODES[code]
  }
}

export interface PublicError {
  status: number
  body: { error: string; code: ErrorCode }
}

/**
 * The status and JSON body a browser receives for any thrown value.
 *
 * @param fallbackMessage Generic message for anything that is not an HttpError.
 */
export function publicError(error: unknown, fallbackMessage: string): PublicError {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return { status: 500, body: { error: fallbackMessage, code: 'internal' } }
}

export interface LoggableError {
  name: string
  code?: string | number
  message?: string
}

/**
 * Fields that are safe to log for any error. HttpError messages are authored here and
 * logged verbatim; any other message comes from a third party, so it is redacted.
 */
export function loggableError(error: unknown): LoggableError {
  if (error instanceof HttpError) {
    return { name: error.name, code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      message: redact(error.message),
    }
  }
  return { name: typeof error }
}

/** The `code` of an SDK error (Stripe, Firebase Admin), or undefined. */
export function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/** A thrown value's message for server-side records, with a fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
