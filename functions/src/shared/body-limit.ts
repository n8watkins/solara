// Request body limits, enforced before anything reads the body (REVIEW8 SEC L1, REVIEW9
// SEC9 H1).
//
// Cloud Run hands each request to the Functions Framework, whose body parsers read and
// parse every body up to 1 GiB (Cloud Run itself stops at 32 MiB) before the function
// runs. A size check inside a handler is therefore too late: one 30 MB JSON body took a
// 256 MiB instance from about 135 MB to over 400 MB before the handler could refuse it.
//
// The parsers (body-parser) also unpack `Content-Encoding: gzip`, `deflate` and `br`
// bodies, up to that same 1 GiB, and keep the unpacked bytes as `rawBody`. A limit on the
// bytes that arrive does not bound what they unpack to: a 334-byte brotli body became
// 200 MB of JSON and took the Stripe webhook's process to 1.9 GB (REVIEW9 SEC9 H1).
//
// So the deploy entry point (index.ts) installs this guard on `http.createServer`, which
// the framework calls after loading the functions. Every request to an HTTP function is
// checked before the framework's parsers see it:
//
// - a request whose `Content-Encoding` is present and not `identity` never reaches the
//   parsers: a body declared within the limit is read off the wire, thrown away and
//   answered 415 (so its sender gets the answer, not a reset), any other is answered 415
//   at once without reading it; the connection is closed. Nothing Solara serves
//   is sent compressed: the browser's fetch never compresses a request body, Stripe
//   sends its events as the JSON it signs (https://docs.stripe.com/webhooks, "Verify
//   webhook signatures manually": the signed payload is "the actual JSON payload (that
//   is, the request body)"), and Cloud Run passes the header and body through unchanged;
// - a declared Content-Length over the limit is answered 413 at once, without reading
//   the body, and the connection is closed;
// - a body without a length (chunked) is held back as it arrives and handed to the
//   framework only once it is complete and within the limit; the moment it passes the
//   limit, reading from the socket stops, the request is answered 413 and the connection
//   is closed, so neither the parsers nor the function ever see it.
//
// Only HTTP functions (the INSTANCE_CAPS table, which a test keeps equal to the deployed
// `onRequest` functions) are guarded (REVIEW9 SEC9 I4). The event-driven ones (Firestore
// triggers, Pub/Sub, schedules, the task queue) are private Cloud Run services that only
// Google's own callers can reach, with the invoker role, and their bodies are Google's
// event envelopes: a Firestore trigger's event carries the document before and after the
// write, up to about 2 MiB, which an 8 KiB limit would refuse, and the event would then
// silently never run. When the target is not known (the emulator may serve several
// functions from one process) the request is guarded with the largest limit.
//
// functions/test/body-limit.test.js runs the real Functions Framework on the deploy
// entry point to prove each case.

import http from 'node:http'

import { HttpError, publicError } from './errors'
import { ThrottledLog } from './log-throttle'
import { type HttpFunctionName, INSTANCE_CAPS } from './options'

/** The largest request body most endpoints accept: every one of them is tiny JSON. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024

/**
 * Endpoints that accept a larger body. Stripe's event payloads are a few KiB; anything
 * far larger is not from Stripe.
 */
export const MAX_BODY_BYTES: Readonly<Partial<Record<HttpFunctionName, number>>> = Object.freeze({
  stripeWebhook: 256 * 1024,
})

/** The largest body any endpoint accepts, used when the serving function is unknown. */
export const LARGEST_MAX_BODY_BYTES = Math.max(
  DEFAULT_MAX_BODY_BYTES,
  ...Object.values(MAX_BODY_BYTES),
)

/**
 * The body limit of the function `target`, or the largest limit when the target is not
 * known (the emulator may serve several functions from one process).
 */
export function maxBodyBytesFor(target: string | undefined): number {
  if (!target) return LARGEST_MAX_BODY_BYTES
  return Object.hasOwn(MAX_BODY_BYTES, target)
    ? (MAX_BODY_BYTES[target as HttpFunctionName] ?? DEFAULT_MAX_BODY_BYTES)
    : DEFAULT_MAX_BODY_BYTES
}

/**
 * Whether requests to the function `target` are guarded: every HTTP function, and any
 * request when the target is not known. Event-driven targets are not (see above).
 */
export function guardsTarget(target: string | undefined): boolean {
  return !target || Object.hasOwn(INSTANCE_CAPS, target)
}

/**
 * Whether a `Content-Encoding` header asks the parsers to unpack the body: anything but
 * no header or `identity` (any case, and only that one value; Node joins repeated headers
 * with commas, so a stacked `identity, gzip` is refused too).
 */
export function isEncodedBody(contentEncoding: string | string[] | undefined): boolean {
  if (contentEncoding === undefined) return false
  const value = Array.isArray(contentEncoding) ? contentEncoding.join(',') : contentEncoding
  return value.trim().toLowerCase() !== 'identity'
}

type RequestListener = (req: http.IncomingMessage, res: http.ServerResponse) => void

const rejections = new ThrottledLog()

interface Refusal {
  status: 413 | 415
  log: string
  error: HttpError
}

const TOO_LARGE = (limit: number): Refusal & { limit: number } => ({
  status: 413,
  log: 'request body too large',
  error: new HttpError('payload-too-large', 'Request too large'),
  limit,
})

const ENCODED: Refusal = {
  status: 415,
  log: 'compressed request body refused',
  error: new HttpError('unsupported-encoding', 'Compressed requests are not accepted'),
}

function refuse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  refusal: Refusal & { limit?: number },
  discardUpTo = 0,
): void {
  rejections.log('warn', `${refusal.status}:${refusal.error.code}`, refusal.log, {
    function: process.env.FUNCTION_TARGET ?? 'unknown',
    status: refusal.status,
    ...(refusal.limit === undefined ? {} : { limit: refusal.limit }),
  })
  const answer = (close: boolean) => {
    if (res.headersSent) return
    const { status, body } = publicError(refusal.error, refusal.error.message)
    res.statusCode = status
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (close) res.setHeader('Connection', 'close')
    res.end(JSON.stringify(body))
  }
  const cutOff = () => {
    answer(true)
    // Nothing more of this body is read: the connection goes once the answer is sent.
    if (res.writableFinished) req.destroy()
    else res.once('finish', () => req.destroy())
  }
  if (discardUpTo <= 0) {
    cutOff()
    return
  }
  // A body declared within the limit is read off the wire and thrown away, never
  // unpacked, and answered once it has all arrived, on a connection that then closes:
  // answering earlier would close the connection under a sender still writing, which
  // then sees a reset instead of the answer. One that runs past the limit is cut off.
  let received = 0
  req.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > discardUpTo) cutOff()
  })
  req.once('end', () => answer(true))
  req.resume()
}

/**
 * Wraps a request listener so a compressed body, or a body over `limit()` bytes, never
 * reaches it. `isGuarded()` false passes the request through untouched.
 * @returns the guarded listener
 */
export function limitRequestBodies(
  listener: RequestListener,
  limit: () => number,
  isGuarded: () => boolean = () => true,
): RequestListener {
  return (req, res) => {
    if (!isGuarded()) {
      listener(req, res)
      return
    }
    const max = limit()
    // Before anything else: a body the parsers would unpack never reaches them. One of a
    // declared length within the limit is discarded as it arrives, any other is cut off.
    if (isEncodedBody(req.headers['content-encoding'])) {
      const declared = Number(req.headers['content-length'] ?? Number.NaN)
      refuse(req, res, ENCODED, declared <= max ? max : 0)
      return
    }
    const declared = req.headers['content-length']
    if (declared !== undefined) {
      // Node's parser has already refused a malformed length, and it never delivers more
      // bytes than the declared length, so the declaration is the whole check.
      if (Number(declared) > max) {
        refuse(req, res, TOO_LARGE(max))
        return
      }
      listener(req, res)
      return
    }
    if (req.headers['transfer-encoding'] === undefined) {
      listener(req, res)
      return
    }
    // A body without a length is held back as Node's parser pushes it in, and the
    // framework sees the request only once the whole body is known to fit: then the held
    // chunks are handed on and read as usual. Past the limit, `false` tells the parser to
    // stop reading the socket, and the framework never sees the request at all.
    const push = req.push.bind(req)
    const held: Buffer[] = []
    let received = 0
    let refused = false
    req.push = (chunk: unknown, encoding?: BufferEncoding) => {
      if (refused) return false
      if (chunk === null) {
        req.push = push
        for (const piece of held) push(piece)
        push(null)
        // Outside the parser's callback, as Node itself hands over a request.
        process.nextTick(listener, req, res)
        return false
      }
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding)
      received += piece.length
      if (received > max) {
        refused = true
        held.length = 0
        refuse(req, res, TOO_LARGE(max))
        return false
      }
      held.push(piece)
      return true
    }
  }
}

let installed = false

/**
 * Guards every HTTP server this process creates from now on (the Functions Framework
 * creates one after loading the functions), with the serving function's body limit, when
 * the serving function is an HTTP function. Safe to call more than once.
 */
export function installRequestBodyLimit(
  limit: () => number = () => maxBodyBytesFor(process.env.FUNCTION_TARGET),
  isGuarded: () => boolean = () => guardsTarget(process.env.FUNCTION_TARGET),
): void {
  if (installed) return
  installed = true
  const createServer = http.createServer
  const guardedCreateServer = (...args: unknown[]) => {
    const index = args.findIndex(arg => typeof arg === 'function')
    if (index !== -1) {
      args[index] = limitRequestBodies(args[index] as RequestListener, limit, isGuarded)
    }
    return (createServer as (...a: unknown[]) => http.Server)(...args)
  }
  http.createServer = guardedCreateServer as typeof http.createServer
}
