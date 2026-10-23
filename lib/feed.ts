// Live calendar feed (P7b) — client helpers for the Cloud Function `calendarFeed`.
//
// The user subscribes their calendar app to a stable URL that re-fetches periodically;
// the function regenerates the .ics from the latest forecast, so the plan stays current
// without a manual re-export. The token in the URL is the ONLY credential, so it must be
// long, random, and revocable (regenerate to invalidate every existing subscription).

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL

/** Whether the calendarFeed function base URL is configured (Blaze deploy done). */
export function isFeedConfigured(): boolean {
  return !!FUNCTIONS_URL
}

/** A 32-char URL-safe random token. Uses Web Crypto; falls back to Math.random off-browser. */
export function randomFeedToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  const len = 32
  const bytes = new Uint8Array(len)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out
}

/** The subscribe URL for a given token, or null when the feed isn't configured. */
export function buildFeedUrl(token: string): string | null {
  if (!FUNCTIONS_URL || !token) return null
  const base = FUNCTIONS_URL.replace(/\/$/, '')
  return `${base}/calendarFeed?token=${encodeURIComponent(token)}`
}

/** The webcal:// variant some calendar apps (Apple) prefer for one-tap subscribe. */
export function buildWebcalUrl(token: string): string | null {
  const url = buildFeedUrl(token)
  return url ? url.replace(/^https?:\/\//, 'webcal://') : null
}
