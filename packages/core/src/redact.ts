// Redaction rules for text that leaves the user's browser or a Function in logs and
// error reports. The same rules as functions/src/shared/logging.ts (a parity test in
// lib/sentry-scrub.test.ts keeps them in step), so the web app's error reports and the
// Functions' logs strip the same things.

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Query strings carry coordinates (forecast URLs), share details and feed tokens.
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
