/**
 * Strips the Next.js framework scripts from statically exported pages that need no
 * JavaScript (see scripts/static-pages.mjs). Runs in Node directly (type stripping),
 * so it uses erasable TypeScript syntax and relative imports only. Script tags are
 * found exactly as scripts/csp.mjs finds them (lib/csp.mts), the way browsers
 * tokenize them.
 */
import { SCRIPT_TAG, hasAttribute } from './csp.mts'
import cities from './cities/cities.json' with { type: 'json' }

/**
 * Pages served without the framework, relative to the export directory: the landing
 * page, the city pages (app/uv/), and the Microsoft sign-in redirect page
 * (app/auth/microsoft/), whose address carries a one-time code no other script may see.
 */
export const STATIC_PAGES = [
  'index.html',
  'uv/index.html',
  'auth/microsoft/index.html',
  ...cities.map(city => `uv/${city.slug}/index.html`),
]

/** Inline scripts Next.js writes: the RSC payload, the chunk list and their bootstrap. */
const FRAMEWORK_INLINE =
  /self\.__next_[a-z]|__next_s|globalThis\["TURBOPACK"\]|\$RC\b|\$RS\b|\$RX\b/

/**
 * Marks an inline script of our own that a static page keeps: `<script id="…" data-static>`.
 * Anything else is the framework's.
 */
export const KEEP_ATTRIBUTE = 'data-static'

/**
 * Marks a kept script that must run before anything else on its page loads:
 * `<script data-static data-head-first>`. It is moved to the start of `<head>` (after the
 * charset, and after the Content-Security-Policy that scripts/csp.mjs puts first), so no
 * stylesheet, font or other resource can hold it back: a parser-inserted script waits for
 * every stylesheet before it. The Microsoft redirect page needs this (REVIEW7 M1).
 */
export const HEAD_FIRST_ATTRIBUTE = 'data-head-first'

/** Pages whose hand-over script must run first; the build fails if one has none. */
export const HEAD_FIRST_PAGES = ['auth/microsoft/index.html']

/** `<meta charset>` as the first element of `<head>`, which stays first. */
const LEADING_CHARSET = /^\s*<meta\s+charset\s*=\s*["']?[\w-]+["']?\s*\/?>/i

const LINK = /<link\b[^>]*>/gi

/**
 * Removes every script from a page except the inline scripts marked with
 * KEEP_ATTRIBUTE, and the preloads of the removed scripts. Throws if the page holds
 * an inline script that is neither kept nor recognizably the framework's, if there
 * was nothing to remove (the Next.js output changed), or if framework JavaScript is
 * still referenced.
 */
export function stripFrameworkScripts(html: string): {
  html: string
  removed: number
  /** Scripts moved to the start of `<head>` (HEAD_FIRST_ATTRIBUTE). */
  hoisted: number
} {
  let removed = 0
  const unknown: string[] = []
  const first: string[] = []
  let out = html.replace(SCRIPT_TAG, (tag: string, attributes: string, body: string) => {
    if (hasAttribute(attributes, 'src')) {
      removed++
      return ''
    }
    if (
      hasAttribute(attributes, KEEP_ATTRIBUTE) &&
      hasAttribute(attributes, HEAD_FIRST_ATTRIBUTE)
    ) {
      first.push(tag)
      return ''
    }
    if (hasAttribute(attributes, KEEP_ATTRIBUTE)) return tag
    if (FRAMEWORK_INLINE.test(body)) {
      removed++
      return ''
    }
    unknown.push(body.slice(0, 80))
    return tag
  })
  out = out.replace(LINK, (tag: string) => {
    const preload = /\brel="(?:preload|modulepreload)"/.test(tag)
    if (!preload || !(/\bas="script"/.test(tag) || /\.js["?]/.test(tag))) return tag
    removed++
    return ''
  })
  if (unknown.length) {
    throw new Error(
      `unrecognized inline scripts: ${unknown.map(s => JSON.stringify(s)).join(', ')}`,
    )
  }
  if (removed === 0) throw new Error('no framework scripts found; did the Next.js output change?')
  if (/\/_next\/static\/[^"']*\.js/.test(out)) {
    throw new Error('still references framework JavaScript after stripping')
  }
  if (first.length) out = prependToHead(out, first.join(''))
  return { html: out, removed, hoisted: first.length }
}

/** Puts `markup` first in `<head>`, after a leading `<meta charset>`. */
function prependToHead(html: string, markup: string): string {
  const head = /<head\b[^>]*>/i.exec(html)
  if (!head) throw new Error('a script that must run first, but no <head>')
  let at = head.index + head[0].length
  const charset = LEADING_CHARSET.exec(html.slice(at))
  if (charset) at += charset[0].length
  return html.slice(0, at) + markup + html.slice(at)
}
