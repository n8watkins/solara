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
import type { Request, Response } from 'firebase-functions/v2/https'

import { CLIENT_VERSION_HEADER, parseClientVersion } from '#core/client-version'
import { type AppCheckMode, verifyAppCheck } from './app-check'
import { DEFAULT_MAX_BODY_BYTES } from './body-limit'
import { ProxyHopMonitor, clientScopes } from './client-address'
import type { CostFeature } from './cost-guard'
import { HttpError, loggableError, publicError } from './errors'
import { ThrottledLog } from './log-throttle'
import { FixedWindowLimiter } from './rate-limit'

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
  /**
   * Requests one client address may make per minute to this endpoint, counted before
   * App Check so floods are turned away at the cheapest point. Default 60.
   */
  perAddressPerMinute?: number
  /**
   * The largest request body accepted, in bytes. Default 8 KiB (every body is tiny JSON).
   * The deploy entry point refuses larger bodies before they are read (shared/body-limit.ts);
   * this check is the second line, for any path that skips that guard.
   */
  maxBodyBytes?: number
  /** Turns the endpoint off while the cost guard is engaged (shared/cost-guard.ts). */
  costFeature?: CostFeature
  costGuard?: () => { engaged: () => Promise<boolean> }
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
    res.set(
      'Access-Control-Allow-Headers',
      `Authorization, Content-Type, X-Firebase-AppCheck, ${CLIENT_VERSION_HEADER}`,
    )
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

export const DEFAULT_PER_ADDRESS_PER_MINUTE = 60
export { DEFAULT_MAX_BODY_BYTES }

/** The size of a request body: the larger of the bytes received and the declared length. */
export function requestBodyBytes(req: Request): number {
  const declared = Number(req.headers['content-length'])
  return Math.max(
    req.rawBody?.length ?? 0,
    Number.isFinite(declared) && declared > 0 ? declared : 0,
  )
}

/**
 * One request pipeline for every browser-called endpoint: security headers, an exact-origin
 * CORS check, a single method, a per-address rate limit and a body size limit, an App Check
 * token's presence, the cost guard, App Check verification (with replay protection where
 * requested), then the handler. Errors become an allowlisted `{ error, code }` body;
 * nothing else is echoed.
 *
 * The order makes a rejected request as cheap as possible (finding H1): everything before
 * the handler runs in memory, the cost guard is a cached read (at most one Firestore read
 * a minute per instance, and never for a request without a token), and a guarded path
 * answers 503 before the token is verified. Rejections are logged once a minute per kind
 * (shared/log-throttle.ts), not once per request.
 */
export function createApiHandler<T>({
  name,
  method,
  allowedOrigin,
  appCheck,
  appCheckMode,
  perAddressPerMinute = DEFAULT_PER_ADDRESS_PER_MINUTE,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  costFeature,
  costGuard,
  fallbackMessage,
  handler,
}: ApiHandlerOptions<T>): HttpHandler {
  if (costFeature && !costGuard) throw new TypeError(`${name}: costFeature needs a costGuard`)
  const addressLimiter = new FixedWindowLimiter({ limit: perAddressPerMinute, windowMs: 60_000 })
  const rejections = new ThrottledLog()
  const clients = new ThrottledLog()
  const proxyHops = new ProxyHopMonitor(name)
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
    proxyHops.observe(req)
    // The client build (#core/client-version), validated so a log carries no arbitrary
    // text. Logged now; a too-old native build can be refused here later.
    const parsed = parseClientVersion(req.headers[CLIENT_VERSION_HEADER.toLowerCase()])
    const client = parsed ? `${parsed.platform}/${parsed.version}` : 'unknown'
    try {
      const budget = addressLimiter.take(clientScopes(req))
      if (!budget.allowed) {
        res.set('Retry-After', String(budget.retryAfterSeconds))
        throw new HttpError('rate-limited', 'Too many requests. Try again shortly.')
      }
      if (requestBodyBytes(req) > maxBodyBytes) {
        throw new HttpError('payload-too-large', 'Request too large')
      }
      const token = req.headers['x-firebase-appcheck']
      if (typeof token !== 'string' || !token) {
        throw new HttpError('app-check-required', 'App verification required')
      }
      if (costFeature && (await costGuard?.().engaged())) {
        throw new HttpError('unavailable', 'This feature is paused. Try again later.', {
          cause: new Error(`cost guard engaged for ${costFeature}`),
        })
      }
      await verifyAppCheck(appCheck(), token, appCheckMode)
      // Only verified requests, once a minute per build and instance.
      clients.log('info', client, `${name} client`, { function: name, client })
      const result = await handler(req)
      res.status(result.status ?? 200).json(result.body)
    } catch (error) {
      const { status, body } = publicError(error, fallbackMessage)
      const fields = { function: name, status, client, error: loggableError(error) }
      // An allowlisted rejection (including 503 `unavailable` while a feature is paused)
      // is expected and a WARNING; anything else is a failure and an ERROR. Either way
      // a flood logs one line a minute per kind, with the count of lines it held back.
      if (error instanceof HttpError && (status < 500 || error.code === 'unavailable')) {
        rejections.log('warn', `${status}:${error.code}`, `${name} rejected`, fields)
      } else {
        rejections.log('error', `${status}:failed`, `${name} failed`, fields)
      }
      res.status(status).json(body)
    }
  }
}

export { TRUSTED_PROXY_HOPS, clientAddress, clientScopes } from './client-address'
