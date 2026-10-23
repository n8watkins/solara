// Structured logging rules for every Function.
//
// Log through `logger` from `firebase-functions/logger` (never `console`), with a short
// constant message and the details as structured fields, so Cloud Logging can filter on
// them and attach the right severity:
//
//   logger.warn('stripeWebhook signature rejected', loggableError(error))
//
// Never log bearer or App Check tokens, feed or FCM tokens, email addresses or
// coordinates. Log ids (uid, event id, device id) instead. Text that comes from a third
// party (an SDK error message) goes through `redact` first; `loggableError` does that.

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Query strings carry coordinates (forecast URLs) and feed tokens (calendar feed URLs).
const URL_QUERY = /(\bhttps?:\/\/[^\s?#"']+)[?#][^\s"']*/g
const COORDINATE_FIELD = /\b(lat|lon|lng|latitude|longitude)(["']?\s*[:=]\s*)-?\d+(?:\.\d+)?/gi
// ID and App Check tokens are JWTs: three dot-separated base64url segments.
const JWT = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
// FCM registration tokens and feed tokens are long runs of base64url characters; ids such
// as Stripe or Firestore ids are much shorter.
const LONG_TOKEN = /[A-Za-z0-9_-]{40,}/g

/** Removes email addresses, URL query strings, coordinates and token-like strings. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(URL_QUERY, '$1?[redacted]')
    .replace(COORDINATE_FIELD, '$1$2[redacted]')
    .replace(JWT, '[token]')
    .replace(LONG_TOKEN, '[token]')
}
