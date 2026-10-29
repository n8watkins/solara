// Request body limits, enforced before anything reads the body (REVIEW8 SEC L1).
//
// Cloud Run hands each request to the Functions Framework, whose body parsers read and
// parse every body up to 1 GiB (Cloud Run itself stops at 32 MiB) before the function
// runs. A size check inside a handler is therefore too late: one 30 MB JSON body took a
// 256 MiB instance from about 135 MB to over 400 MB before the handler could refuse it.
//
// So the deploy entry point (index.ts) installs this guard on `http.createServer`, which
// the framework calls after loading the functions. Every request is checked before the
// framework's parsers see it:
//
// - a declared Content-Length over the limit is answered 413 at once, without reading
//   the body, and the connection is closed;
// - a body without a length (chunked) is held back as it arrives and handed to the
//   framework only once it is complete and within the limit; the moment it passes the
//   limit, reading from the socket stops, the request is answered 413 and the connection
//   is closed, so neither the parsers nor the function ever see it.
//
// functions/test/body-limit.test.js runs the real Functions Framework on the deploy
// entry point to prove both.

import http from 'node:http'

import { HttpError, publicError } from './errors'
import { ThrottledLog } from './log-throttle'
import type { HttpFunctionName } from './options'

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

type RequestListener = (req: http.IncomingMessage, res: http.ServerResponse) => void

const rejections = new ThrottledLog()

function refuse(req: http.IncomingMessage, res: http.ServerResponse, limit: number): void {
  rejections.log('warn', '413:payload-too-large', 'request body too large', {
    function: process.env.FUNCTION_TARGET ?? 'unknown',
    status: 413,
    limit,
  })
  if (!res.headersSent) {
    const { status, body } = publicError(
      new HttpError('payload-too-large', 'Request too large'),
      'Request too large',
    )
    res.statusCode = status
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Connection', 'close')
    res.end(JSON.stringify(body))
  }
  // Nothing more of this body is read: the connection goes once the answer is sent.
  if (res.writableFinished) req.destroy()
  else res.once('finish', () => req.destroy())
}

/**
 * Wraps a request listener so a body over `limit()` bytes never reaches it.
 * @returns the guarded listener
 */
export function limitRequestBodies(
  listener: RequestListener,
  limit: () => number,
): RequestListener {
  return (req, res) => {
    const max = limit()
    const declared = req.headers['content-length']
    if (declared !== undefined) {
      // Node's parser has already refused a malformed length, and it never delivers more
      // bytes than the declared length, so the declaration is the whole check.
      if (Number(declared) > max) {
        refuse(req, res, max)
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
        refuse(req, res, max)
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
 * creates one after loading the functions), with the serving function's body limit.
 * Safe to call more than once.
 */
export function installRequestBodyLimit(
  limit: () => number = () => maxBodyBytesFor(process.env.FUNCTION_TARGET),
): void {
  if (installed) return
  installed = true
  const createServer = http.createServer
  const guarded = (...args: unknown[]) => {
    const index = args.findIndex(arg => typeof arg === 'function')
    if (index !== -1) args[index] = limitRequestBodies(args[index] as RequestListener, limit)
    return (createServer as (...a: unknown[]) => http.Server)(...args)
  }
  http.createServer = guarded as typeof http.createServer
}
