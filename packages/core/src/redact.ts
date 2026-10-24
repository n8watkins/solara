// Redaction rules for text that leaves the user's browser or a Function in logs and
// error reports. The web app's error reports and the Functions' logs (which import this
// through #core) strip the same things.

// Bounded and anchored to the start of a run, so a long run of address characters with no
// "@" is scanned once instead of once per start position (no quadratic slowdown).
// Limits follow RFC 5321: 64 characters before the @, 63 per domain label.
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g
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
