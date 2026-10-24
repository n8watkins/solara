/**
 * Personal data scrubbing for Sentry error reports (decision D10).
 *
 * Every event and breadcrumb passes through these functions in `beforeSend` and
 * `beforeBreadcrumb` before it leaves the browser. They remove:
 *
 * - email addresses, JWTs (ID and App Check tokens) and other long tokens, with the
 *   same rules the Functions use for their logs (`redact` in @solara/core);
 * - Firebase Auth uids (28 letters and digits);
 * - coordinates written as `lat=…`, `"lon": …` and similar;
 * - every URL query string and fragment (forecast coordinates, share details,
 *   checkout session ids, OAuth state);
 * - the `user` object, cookies and request headers other than the user agent.
 *
 * Stack frame file names keep their path, which source maps need, but lose any query.
 */
import type { Breadcrumb, ErrorEvent, Exception, StackFrame } from '@sentry/nextjs'
import { redact } from '@solara/core'

// Firebase Auth uids are 28 base62 characters. Word boundaries keep longer ids (Sentry
// event ids are 32 hex characters) and shorter chunk names intact.
const FIREBASE_UID = /\b[A-Za-z0-9]{28}\b/g

/** `redact` plus Firebase uids, for any free text in a report. */
export function scrubText(text: string): string {
  return redact(text).replace(FIREBASE_UID, '[uid]')
}

/** A URL or path without its query string and fragment. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/** Field names whose values are always personal or secret, whatever they look like. */
const SENSITIVE_KEY =
  /^(e-?mail|uid|user_?id|token|id_?token|access_?token|refresh_?token|authorization|cookie|password|secret|lat|lon|lng|latitude|longitude|coords?)$/i

const MAX_DEPTH = 8

/** Scrubs every string in a JSON-like value; sensitive keys are replaced outright. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (Array.isArray(value)) return value.map(item => scrubValue(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(item, depth + 1)
  }
  return result
}

function scrubFrame(frame: StackFrame): StackFrame {
  const { vars: _vars, ...rest } = frame
  return {
    ...rest,
    ...(rest.filename !== undefined && { filename: stripUrlQuery(rest.filename) }),
    ...(rest.abs_path !== undefined && { abs_path: stripUrlQuery(rest.abs_path) }),
  }
}

function scrubException(exception: Exception): Exception {
  return {
    ...exception,
    ...(exception.value !== undefined && { value: scrubText(exception.value) }),
    ...(exception.stacktrace && {
      stacktrace: {
        ...exception.stacktrace,
        ...(exception.stacktrace.frames && {
          frames: exception.stacktrace.frames.map(scrubFrame),
        }),
      },
    }),
  }
}

/** Scrubs one breadcrumb (console messages, clicks, navigations, fetches). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data && { ...breadcrumb.data }
  if (data) {
    // Navigation and fetch breadcrumbs carry URLs in these fields.
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = stripUrlQuery(data[key])
    }
  }
  return {
    ...breadcrumb,
    ...(breadcrumb.message !== undefined && { message: scrubText(breadcrumb.message) }),
    ...(data && { data: scrubValue(data) as Record<string, unknown> }),
  }
}

/** Scrubs a whole error event; see the file comment for what is removed. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request, message, exception, breadcrumbs, extra, contexts, tags } = event
  const scrubbed: ErrorEvent = { ...event }
  delete scrubbed.user
  delete scrubbed.server_name

  if (message !== undefined) scrubbed.message = scrubText(message)
  if (event.logentry) scrubbed.logentry = scrubValue(event.logentry) as ErrorEvent['logentry']
  if (event.transaction) scrubbed.transaction = scrubText(stripUrlQuery(event.transaction))
  if (exception?.values) {
    scrubbed.exception = { ...exception, values: exception.values.map(scrubException) }
  }
  if (breadcrumbs) scrubbed.breadcrumbs = breadcrumbs.map(scrubBreadcrumb)
  if (extra) scrubbed.extra = scrubValue(extra) as ErrorEvent['extra']
  if (tags) scrubbed.tags = scrubValue(tags) as ErrorEvent['tags']
  if (contexts) scrubbed.contexts = scrubValue(contexts) as ErrorEvent['contexts']
  if (request) {
    const userAgent = request.headers?.['User-Agent']
    scrubbed.request = {
      ...(request.url !== undefined && { url: scrubText(stripUrlQuery(request.url)) }),
      ...(userAgent !== undefined && { headers: { 'User-Agent': userAgent } }),
    }
  }
  return scrubbed
}
