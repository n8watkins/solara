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

const LINK = /<link\b[^>]*>/gi

/**
 * Removes every script from a page except the inline scripts marked with
 * KEEP_ATTRIBUTE, and the preloads of the removed scripts. Throws if the page holds
 * an inline script that is neither kept nor recognizably the framework's, if there
 * was nothing to remove (the Next.js output changed), or if framework JavaScript is
 * still referenced.
 */
export function stripFrameworkScripts(html: string): { html: string; removed: number } {
  let removed = 0
  const unknown: string[] = []
  let out = html.replace(SCRIPT_TAG, (tag: string, attributes: string, body: string) => {
    if (hasAttribute(attributes, 'src')) {
      removed++
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
  return { html: out, removed }
}
