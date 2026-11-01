// A page left open across a deploy (REVIEW10 VERIFY10 N2). Each Hosting release replaces
// every file, so the code a long-open page loads on demand (Firebase for sign-in, the
// dialogs) is gone: the server answers 404, and the person was told to check their
// connection, which never helped until a reload.
//
// When code the person asked for fails to load, recoverFromStaleBuild asks the server for
// that very file. A 404 means a newer version is live: the page reloads once to it, and
// the reloaded page says why (takeUpdateNotice). Everything a person has entered is
// already kept (a guest's plan in this browser, an account's in Firestore), and the
// address stays, so the reload loses nothing but the part that never opened. Offline,
// or when the file is still there, nothing reloads and the caller says what failed.

/** sessionStorage key: when this tab last reloaded for a new version, and why. */
export const UPDATE_RELOAD_KEY = 'solara.update-reload'

/** A second failure this soon after a reload is not reloaded again (no loop). */
export const RELOAD_GUARD_MS = 60_000

/** What the person was doing when the page reloaded, for the notice after it. */
export type UpdateReason = 'sign-in' | 'open'

export type Recovery =
  /** A newer version is live and the page is reloading to it. */
  | 'reloading'
  /** A newer version is live, but this tab already reloaded for it moments ago. */
  | 'updated'
  /** Not a deploy: offline, a network error, or not a failed code load at all. */
  | 'not-stale'

/** A `/_next/static/` file named in a failed load's message (Turbopack, webpack, browsers). */
const STATIC_FILE = /(?:https?:\/\/[^\s"'()]+)?\/_next\/static\/[^\s"'()]+?\.(?:m?js|css)\b/

/**
 * The URL of the code file whose failed download `error` reports, or null when `error`
 * is not a failed load of the app's own code. Turbopack writes "Failed to load chunk
 * /_next/static/chunks/x.js from module ...", webpack "Loading chunk 12 failed.
 * (error: https://.../x.js)" and browsers "Failed to fetch dynamically imported module:
 * https://.../x.js".
 */
export function failedCodeUrl(error: unknown, origin: string): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    const message = (e as { message?: unknown }).message
    const found = typeof message === 'string' ? STATIC_FILE.exec(message)?.[0] : undefined
    if (found) {
      const url = new URL(found, origin)
      return url.origin === origin ? url.href : null
    }
    e = (e as { cause?: unknown }).cause
  }
  return null
}

/** Whether the server no longer has `url` (a 404 or 410): a newer version replaced it. */
export async function codeIsGone(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    // HEAD passes the app-shell worker by (it answers GETs only), so this is the server's
    // answer, never a cached copy.
    const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' })
    return response.status === 404 || response.status === 410
  } catch {
    return false
  }
}

interface Env {
  origin: string
  online: boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  reload: () => void
  now: number
  fetchImpl?: typeof fetch
}

function browserEnv(): Env {
  let storage: Env['storage'] = null
  try {
    storage = window.sessionStorage
  } catch {}
  return {
    origin: window.location.origin,
    online: navigator.onLine,
    storage,
    reload: () => window.location.reload(),
    now: Date.now(),
  }
}

function readMarker(
  storage: Env['storage'],
): { at: number; reason: UpdateReason; shown?: true } | null {
  try {
    const value = JSON.parse(storage?.getItem(UPDATE_RELOAD_KEY) ?? 'null') as unknown
    if (!value || typeof value !== 'object') return null
    const { at, reason, shown } = value as Record<string, unknown>
    if (typeof at !== 'number' || (reason !== 'sign-in' && reason !== 'open')) return null
    return { at, reason, ...(shown === true && { shown: true }) }
  } catch {
    return null
  }
}

/**
 * After code the person asked for failed to load (`error`): reloads the page once when the
 * server no longer has that code, because a newer version is live. See the module comment.
 */
export async function recoverFromStaleBuild(
  error: unknown,
  reason: UpdateReason,
  env: Env = browserEnv(),
): Promise<Recovery> {
  const url = failedCodeUrl(error, env.origin)
  if (!url || !env.online) return 'not-stale'
  if (!(await codeIsGone(url, env.fetchImpl))) return 'not-stale'
  const last = readMarker(env.storage)
  // Without sessionStorage there is no guard against a loop, so no automatic reload.
  if (!env.storage || (last && env.now - last.at < RELOAD_GUARD_MS)) return 'updated'
  try {
    env.storage.setItem(UPDATE_RELOAD_KEY, JSON.stringify({ at: env.now, reason }))
  } catch {
    return 'updated'
  }
  env.reload()
  return 'reloading'
}

/** This page load's notice, read once (a second render asks again and gets the same). */
let pageNotice: { reason: UpdateReason | null } | null = null

/**
 * Why this tab reloaded to a new version: the notice shows on the first load after the
 * reload only, however often it is asked for. The marker itself stays, as the guard
 * against a second reload.
 */
export function takeUpdateNotice(
  env: Pick<Env, 'storage' | 'now'> = browserEnv(),
): UpdateReason | null {
  if (pageNotice) return pageNotice.reason
  const marker = readMarker(env.storage)
  const fresh = marker && !marker.shown && env.now - marker.at <= RELOAD_GUARD_MS
  pageNotice = { reason: fresh ? marker.reason : null }
  if (fresh) {
    try {
      env.storage?.setItem(UPDATE_RELOAD_KEY, JSON.stringify({ ...marker, shown: true }))
    } catch {}
  }
  return pageNotice.reason
}

/** Forgets this page load's notice (tests). */
export function resetUpdateNoticeForTests(): void {
  pageNotice = null
}
