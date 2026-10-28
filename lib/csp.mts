/**
 * Content Security Policy for the static export.
 *
 * Firebase Hosting can only send fixed headers, but Next.js inlines different
 * bootstrap scripts into every page. So the policy is split in two:
 *
 * - `scripts/csp.mjs` (postbuild) writes a per-page `<meta http-equiv>` policy
 *   into each HTML file in `out/`, with the SHA-256 hash of every inline script
 *   on that page. No `'unsafe-inline'` for scripts, and the hashes ship inside
 *   the same artifact as the HTML they protect.
 * - `firebase.json` sends the directives a meta tag cannot carry
 *   (`frame-ancestors`) plus a few defense-in-depth ones, as a header.
 *
 * The browser enforces both; a request must pass each policy.
 *
 * This file runs in Node directly (type stripping) from scripts/csp.mjs, so it
 * uses relative imports only and erasable TypeScript syntax.
 */
import { createHash } from 'node:crypto'

export interface CspEnv {
  /** NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: hosts the sign-in helper iframe. */
  authDomain?: string
  /** NEXT_PUBLIC_FUNCTIONS_URL: origin of the account, billing and feed endpoints. */
  functionsUrl?: string
  /**
   * NEXT_PUBLIC_FIREBASE_EMULATORS=1: a build for the signed-in e2e suite only, which
   * production builds refuse (scripts/check-no-emulators.mjs). Its sign-in helper
   * comes from the Auth emulator, served on the page's own origin.
   */
  emulators?: boolean
  /** NEXT_PUBLIC_SENTRY_DSN: error reports go to this DSN's ingest host. */
  sentryDsn?: string
}

/** The CSP env for the current build, from the same variables `next build` reads. */
export function cspEnvFrom(env: Record<string, string | undefined>): CspEnv {
  return {
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    functionsUrl: env.NEXT_PUBLIC_FUNCTIONS_URL,
    emulators: env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1',
    sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
  }
}

export type CspDirectives = Record<string, string[]>

/** Directives a `<meta>` policy cannot express; Firebase Hosting sends these. */
export const HEADER_POLICY: CspDirectives = {
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],
}

// Each third-party source and what needs it. Keep the privacy policy's
// processor list in sync when adding one.
const SCRIPT_SOURCES = [
  'https://apis.google.com', // Firebase Auth popup helper (gapi)
  'https://accounts.google.com/gsi/', // Google Identity Services, Calendar connect
  'https://www.googletagmanager.com', // GA4, only after analytics consent
  // App Check reCAPTCHA, signed-in pages only: api.js, then its versioned release
  // script. Google's documented CSP for reCAPTCHA:
  // https://developers.google.com/recaptcha/docs/faq#im-using-content-security-policy-csp-on-my-website.-how-can-i-configure-it-to-work-with-recaptcha
  'https://www.google.com/recaptcha/',
  'https://www.gstatic.com/recaptcha/',
]

const CONNECT_SOURCES = [
  'https://identitytoolkit.googleapis.com', // Firebase Auth
  'https://securetoken.googleapis.com', // Firebase Auth token refresh
  'https://firestore.googleapis.com', // Firestore
  'https://firebaseinstallations.googleapis.com', // Firebase Installations (messaging)
  'https://fcmregistrations.googleapis.com', // Firebase Cloud Messaging tokens
  'https://content-firebaseappcheck.googleapis.com', // App Check
  'https://www.googleapis.com', // Google Calendar REST API
  'https://accounts.google.com/gsi/', // Google Identity Services
  'https://oauth2.googleapis.com', // Revoking Calendar access (GIS oauth2.revoke)
  // Events from Outlook (lib/microsoft-auth.ts, lib/outlook-events.ts): redeeming the
  // sign-in code (the sign-in itself is a popup, a top-level page this policy does not
  // govern), and reading calendars from Microsoft Graph. No script, frame or image source.
  'https://login.microsoftonline.com',
  'https://graph.microsoft.com',
  // App Check reCAPTCHA: api.js posts client reports to /recaptcha/api2/clr from the
  // page itself (seen in tests/e2e/integrations against the real script).
  'https://www.google.com/recaptcha/',
  'https://api.open-meteo.com', // forecasts
  'https://geocoding-api.open-meteo.com', // city search
  'https://nominatim.openstreetmap.org', // "use my location" place names
  // GA4 picks a regional collection host at runtime, so Google documents these
  // wildcards as required: https://developers.google.com/tag-platform/security/guides/csp
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
]

const FRAME_SOURCES = [
  'https://accounts.google.com/gsi/',
  // reCAPTCHA's invisible widget frame, and Google's fallback host for it.
  'https://www.google.com/recaptcha/',
  'https://recaptcha.google.com/recaptcha/',
]

const IMG_SOURCES = [
  'https://*.googleusercontent.com', // Google profile photos
  // Firestore's WebChannel transport loads this one image to test connectivity
  // after a connection error. A path without a trailing slash matches only itself.
  'https://www.google.com/images/cleardot.gif',
  'https://*.google-analytics.com',
  'https://*.googletagmanager.com',
]

/** `https://host` for a host name or URL, or null if it is not a valid https origin. */
export function httpsOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The ingest origin of a Sentry public DSN (`https://<key>@o1.ingest.us.sentry.io/2`
 * gives `https://o1.ingest.us.sentry.io`), or null if the value is not one. A DSN with
 * a password (a legacy secret key) is refused: it must never reach a browser.
 */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  const trimmed = dsn?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || !url.username || url.password) return null
    if (!/^\/\d+$/.test(url.pathname)) return null
    return url.origin
  } catch {
    return null
  }
}

/** `'sha256-…'` source for an inline script's exact text. */
export function scriptHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`
}

/**
 * A `<script>` element as browsers tokenize it: the tag name ends at whitespace,
 * `/` or `>` (so `<scripts>` and `<script-x>` are other elements); quoted attribute
 * values may contain `>`; the text runs to the first `</script` followed by
 * whitespace, `/` or `>`, in any case, and that end tag runs to the next `>`
 * (`</script >` and `</SCRIPT\n foo>` both end it).
 */
export const SCRIPT_TAG =
  /<script(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script(?=[\s/>])[^>]*>/gi

/** One attribute in a start tag: its name, then an optional quoted or bare value. */
const ATTRIBUTE = /([^\s"'/>=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

/** Whether a start tag's attribute text has the attribute `name` (case-insensitive). */
export function hasAttribute(attributes: string, name: string): boolean {
  for (const [, attribute = ''] of attributes.matchAll(ATTRIBUTE)) {
    if (attribute.toLowerCase() === name) return true
  }
  return false
}

/** Hashes of every inline (non-`src`) script in an HTML document, in order, deduplicated. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const [, attributes = '', body = ''] = match
    if (hasAttribute(attributes, 'src')) continue
    const hash = scriptHash(body)
    if (!hashes.includes(hash)) hashes.push(hash)
  }
  return hashes
}

/** Inline event-handler attributes (`onclick="…"`), which the policy blocks. */
export function inlineEventHandlers(html: string): string[] {
  return [...html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)].map(match => match[1] ?? '')
}

/** The full per-page policy delivered by `<meta>`. */
export function pagePolicy(hashes: string[], env: CspEnv = {}): CspDirectives {
  const authOrigin = httpsOrigin(env.authDomain)
  const functionsOrigin = httpsOrigin(env.functionsUrl)
  // Only builds with a DSN may talk to Sentry, and only to that DSN's host.
  const sentryOrigin = sentryIngestOrigin(env.sentryDsn)
  const present = (values: Array<string | null>) => values.filter((v): v is string => !!v)
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...hashes, ...SCRIPT_SOURCES],
    'script-src-attr': ["'none'"],
    // React renders `style` attributes, which need 'unsafe-inline' for styles.
    // Styles cannot run code; scripts stay hash-only.
    'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', ...IMG_SOURCES],
    'connect-src': ["'self'", ...present([functionsOrigin, sentryOrigin]), ...CONNECT_SOURCES],
    'frame-src': [...(env.emulators ? ["'self'"] : []), ...present([authOrigin]), ...FRAME_SOURCES],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'media-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  }
}

/**
 * The policy of the Microsoft sign-in redirect page, /auth/microsoft/ (REVIEW7 L6). A
 * one-time code sits in its address, and the page needs nothing but its own inline scripts
 * (the theme and the hand-over, by hash), its stylesheets, font and icon: no Google, Tag
 * Manager, reCAPTCHA or other third-party origin, and no connection of any kind (the
 * hand-over is a BroadcastChannel, which no policy governs).
 */
export function redirectPagePolicy(hashes: string[]): CspDirectives {
  return {
    'default-src': ["'none'"],
    'script-src': hashes.length ? hashes : ["'none'"],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'"],
    'font-src': ["'self'"],
    'img-src': ["'self'"],
    'manifest-src': ["'self'"],
    'connect-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'none'"],
    'media-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  }
}

/**
 * Pages with a policy of their own instead of pagePolicy, by their path in the export
 * (forward slashes).
 */
export const OWN_POLICY_PAGES: Record<string, (hashes: string[]) => CspDirectives> = {
  'auth/microsoft/index.html': redirectPagePolicy,
}

export function serializePolicy(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ')
}

/** Attribute-safe text for a policy (it never contains quotes that need escaping, but be strict). */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const META_TAG = /<meta http-equiv="Content-Security-Policy"[^>]*>/i

/**
 * Put the policy in a `<meta>` as the very first element of `<head>`, before
 * any script, replacing an existing one so the step can run twice.
 */
/**
 * Google Search Console ownership files (`google<16 hex>.html`) are plain text
 * that must be served byte for byte, so the CSP step leaves them alone. They run
 * no script; the header policy in firebase.json still applies to them.
 */
export function isSiteVerificationFile(name: string, contents: string): boolean {
  return (
    /^google[0-9a-f]{16}\.html$/.test(name) &&
    contents.trim() === `google-site-verification: ${name}`
  )
}

export function injectCspMeta(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}"/>`
  const withoutOld = html.replace(META_TAG, '')
  const head = /<head\b[^>]*>/i.exec(withoutOld)
  if (!head) throw new Error('HTML document has no <head>')
  const at = head.index + head[0].length
  return withoutOld.slice(0, at) + meta + withoutOld.slice(at)
}
