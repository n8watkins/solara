// The HTTP pipeline shared by every browser-called endpoint.
//
// Why `onRequest` and not `onCall` (finding BE-20, decided in plan lane W2-B):
// `onCall` would give App Check enforcement, replay protection (`consumeAppCheckToken`)
// and auth decoding for free, but it changes the browser contract: every call becomes a
// POST with a `{ data }` envelope and `{ result }` / `{ error: { status } }` replies, so
// `GET` export and `DELETE` endpoints, the exact-origin CORS answer, `Allow` headers and
// the allowlisted `{ error, code }` body would all change, and the web client would have
// to move to `httpsCallable` in the same release. This pipeline already provides what
// `onCall` would: exact-origin CORS, a single method, App Check with limited-use tokens
// for checkout and deletion, bearer-token auth in the handlers and an error allowlist.
// Revisit only together with a client change; the handlers are transport-agnostic.

import type { AppCheck } from 'firebase-admin/app-check'
import { logger } from 'firebase-functions/logger'
import type { Request, Response } from 'firebase-functions/v2/https'

import { type AppCheckMode, verifyAppCheck } from './app-check'
import { HttpError, loggableError, publicError } from './errors'

export type ApiMethod = 'GET' | 'POST' | 'DELETE'

export interface ApiResult<T> {
  status?: number
  body: T
}

export interface ApiHandlerOptions<T> {
  /** The exported function name, used in logs. */
  name: string
  method: ApiMethod
  allowedOrigin: () => string
  appCheck: () => AppCheck
  appCheckMode: AppCheckMode
  /** Public message for any failure that is not an HttpError. */
  fallbackMessage: string
  handler: (req: Request) => Promise<ApiResult<T>>
}

export type HttpHandler = (req: Request, res: Response) => Promise<void>

/** @returns true when the request was fully answered here */
export function handleCors(
  req: Request,
  res: Response,
  allowedOrigin: string,
  methods: string[],
): boolean {
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

export function setApiHeaders(res: Response): void {
  res.set('Cache-Control', 'no-store')
  res.set('Content-Type', 'application/json; charset=utf-8')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
}

/**
 * One request pipeline for every browser-called endpoint: security headers, an exact-origin
 * CORS check, a single method, App Check (with replay protection where requested), then the
 * handler. Errors become an allowlisted `{ error, code }` body; nothing else is echoed.
 */
export function createApiHandler<T>({
  name,
  method,
  allowedOrigin,
  appCheck,
  appCheckMode,
  fallbackMessage,
  handler,
}: ApiHandlerOptions<T>): HttpHandler {
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
      const fields = { function: name, status, error: loggableError(error) }
      if (status >= 500) logger.error(`${name} failed`, fields)
      else logger.warn(`${name} rejected`, fields)
      res.status(status).json(body)
    }
  }
}

/**
 * How many X-Forwarded-For entries, counted from the right, Google's own proxies add.
 * The Functions are called on their Cloud Run URLs with no load balancer or Hosting
 * rewrite in front, and Google's front end appends exactly one entry: the address the
 * connection came from. Everything to its left was sent by the client and can be forged.
 * An external HTTPS load balancer in front would append `<client>,<load balancer>`,
 * making this 2; change it together with any such change to how the Functions are served.
 */
export const TRUSTED_PROXY_HOPS = 1

/**
 * The client address for coarse abuse limits: the X-Forwarded-For entry Google
 * appended (see TRUSTED_PROXY_HOPS), never one the client could have sent.
 * Without the header (local runs and tests), the socket's peer address.
 */
export function clientAddress(req: Request, trustedHops = TRUSTED_PROXY_HOPS): string {
  const header = req.headers['x-forwarded-for']
  const entries = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map(entry => entry.trim())
  const appended = entries.length >= trustedHops ? entries[entries.length - trustedHops] : ''
  return appended || req.socket?.remoteAddress || 'unknown'
}
