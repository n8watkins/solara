/**
 * The app-shell service worker's rules, shared by the build (scripts/build-sw.mjs,
 * which lists what to precache) and the worker itself (scripts/sw/shell.ts, which
 * decides what to answer). Pure functions with no Node or service-worker globals, so
 * they run in both and are unit tested. Runs in Node directly (type stripping), so it
 * uses erasable TypeScript syntax only.
 *
 * What the worker handles, and nothing else:
 * - navigations to the shell pages (`/` and `/app/`): network first, the precached
 *   copy only when the network fails or stalls, so a deploy is never hidden behind an
 *   old page;
 * - `/_next/static/` files (content-hashed, immutable): from the cache, else fetched
 *   and kept for this version;
 * - the other precached files (manifest, icons, landing images): from the cache.
 * Everything else (cross-origin requests such as Open-Meteo, Firestore, Auth and
 * Functions; Firebase's reserved `/__/` paths; other pages; anything but GET) goes to
 * the network untouched and is never stored. The forecast offline comes from the
 * app's own validated cache in localStorage (lib/cache.ts), not from the worker.
 */

/** The pages the shell precaches, by URL, with their file in the export. */
export const SHELL_PAGES: readonly { url: string; file: string }[] = [
  { url: '/', file: 'index.html' },
  { url: '/app/', file: 'app/index.html' },
]

/** Cache name prefixes; the build version follows. Other caches are never touched. */
export const SHELL_CACHE_PREFIX = 'solara-shell-'
export const STATIC_CACHE_PREFIX = 'solara-static-'

/** How long a shell navigation waits for the network before the precached page. */
export const NAVIGATION_TIMEOUT_MS = 4000

/** The worker's file, served from the site root so its scope is the whole site. */
export const SHELL_WORKER_URL = '/sw.js'

/** The two caches of one version. */
export function cacheNames(version: string): { shell: string; static: string } {
  return { shell: SHELL_CACHE_PREFIX + version, static: STATIC_CACHE_PREFIX + version }
}

/** Caches an activating version deletes: every shell or static cache of another version. */
export function staleCaches(keys: readonly string[], version: string): string[] {
  const current = cacheNames(version)
  return keys.filter(
    key =>
      (key.startsWith(SHELL_CACHE_PREFIX) || key.startsWith(STATIC_CACHE_PREFIX)) &&
      key !== current.shell &&
      key !== current.static,
  )
}

// ---- Build time: what a page loads ------------------------------------------------

/** A `/_next/static/` path, as it appears in attributes and in the inline RSC data. */
const NEXT_STATIC = /\/_next\/static\/[\w\-.~@%/]+/g
/** src, href and srcset attribute values. */
const ATTRIBUTE = /\s(?:src|href|srcset)\s*=\s*"([^"]*)"/gi
/** url(...) in a stylesheet, quoted or not. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/**
 * A root-relative URL of a file (not a page): `/icon-192.png`, not `/privacy/`,
 * `/app/?signin` or `//cdn.example`.
 */
function isFileUrl(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false
  if (/[?#]/.test(url) || url.endsWith('.html')) return false
  const last = url.slice(url.lastIndexOf('/') + 1)
  return last.includes('.')
}

/**
 * Same-origin files an exported page loads: every `/_next/static/` path it names
 * (scripts, stylesheets and fonts in its tags, and the client chunks listed only in
 * its inline RSC data) and the files its tags reference (manifest, icons, images).
 * Links to other pages are not files and are left out. Sorted, without duplicates.
 */
export function pageAssets(html: string): string[] {
  const found = new Set<string>(html.match(NEXT_STATIC) ?? [])
  for (const [, value] of html.matchAll(ATTRIBUTE)) {
    // A srcset lists "url descriptor" pairs.
    for (const candidate of value!.split(',')) {
      const url = candidate.trim().split(/\s+/)[0] ?? ''
      if (isFileUrl(url)) found.add(url)
    }
  }
  return [...found].sort()
}

/** Same-origin files a stylesheet at `cssUrl` loads (fonts, images), as root-relative URLs. */
export function stylesheetAssets(css: string, cssUrl: string): string[] {
  const found = new Set<string>()
  for (const [, , ref] of css.matchAll(CSS_URL)) {
    const value = ref!.trim()
    if (/^(data|blob):/i.test(value) || value.startsWith('#')) continue
    const url = new URL(value, new URL(cssUrl, 'https://solara.invalid'))
    if (url.origin !== 'https://solara.invalid') continue
    if (isFileUrl(url.pathname)) found.add(url.pathname)
  }
  return [...found].sort()
}

/** The icons a web app manifest names, as root-relative URLs. */
export function manifestIcons(manifest: unknown): string[] {
  const icons = (manifest as { icons?: unknown } | null)?.icons
  if (!Array.isArray(icons)) return []
  return icons
    .map(icon => (icon as { src?: unknown } | null)?.src)
    .filter((src): src is string => typeof src === 'string' && isFileUrl(src))
    .sort()
}

// ---- Run time: what the worker answers ----------------------------------------------

/** The precached page for a navigation to `pathname`, or null for any other page. */
export function shellPageFor(pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return '/'
  if (pathname === '/app' || pathname === '/app/' || pathname === '/app/index.html') return '/app/'
  return null
}

export type ShellRoute =
  { kind: 'page'; page: string } | { kind: 'static' } | { kind: 'precached' } | null

/**
 * How the worker answers a request, or null to leave it to the network untouched
 * (and unstored): see the module comment.
 */
export function routeRequest(
  request: { url: string; method: string; mode: string },
  origin: string,
  precached: ReadonlySet<string>,
): ShellRoute {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== origin) return null
  // Firebase Hosting's reserved paths (the Auth helper, init.json).
  if (url.pathname.startsWith('/__/')) return null
  if (request.mode === 'navigate') {
    const page = shellPageFor(url.pathname)
    return page ? { kind: 'page', page } : null
  }
  if (url.pathname.startsWith('/_next/static/')) return { kind: 'static' }
  if (!url.search && precached.has(url.pathname)) return { kind: 'precached' }
  return null
}

/**
 * The `/_next/static/` files a fetched shell page needs that this version did not
 * precache. Not empty when the site was deployed again while this version installed,
 * so the worker refuses to keep a page whose files it does not hold.
 */
export function missingPageAssets(html: string, precached: ReadonlySet<string>): string[] {
  return [...new Set(html.match(NEXT_STATIC) ?? [])].filter(url => !precached.has(url)).sort()
}
