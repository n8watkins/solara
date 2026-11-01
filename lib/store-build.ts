// The store build: Solara inside an app store listing (a Trusted Web Activity on Google
// Play now, the native app later) shows no price, upsell or checkout. Under Play's
// payments policy an app may let people use what they bought elsewhere, but must not sell
// or steer to a web purchase (docs/integrations/ANDROID.md, "consumption only"). Pro
// bought on the web still unlocks everything.
//
// It is on when the build sets NEXT_PUBLIC_STORE_BUILD=1, or at runtime for a session
// opened by an Android app: a TWA's first page has a referrer starting with
// `android-app://`, or its start URL carries `?source=twa` while the page runs in an app
// window (display mode standalone, fullscreen or minimal-ui), as a TWA does. A link with
// `?source=twa` opened in a browser tab therefore changes nothing, so nobody can hide a
// web subscriber's "Manage subscription" with a link (REVIEW9 SEC9 L8). The first page
// remembers it in sessionStorage, so later pages of the same session, whose referrer is
// the site itself, stay in store mode.

import { APP_WINDOW_QUERY, STORE_SESSION_KEY } from './app-routes'

export { APP_WINDOW_QUERY, STORE_SESSION_KEY }

/**
 * Whether a page opened with this referrer and query string, in an app window or not,
 * came from an app store app.
 */
export function openedFromStoreApp(referrer: string, search: string, appWindow: boolean): boolean {
  if (referrer.startsWith('android-app://')) return true
  return appWindow && new URLSearchParams(search).get('source') === 'twa'
}

function inAppWindow(): boolean {
  try {
    return window.matchMedia(APP_WINDOW_QUERY).matches
  } catch {
    return false
  }
}

let session: boolean | undefined

function storeSession(): boolean {
  if (session !== undefined) return session
  let remembered = false
  try {
    remembered = sessionStorage.getItem(STORE_SESSION_KEY) === '1'
  } catch {
    // Storage off: decide from this page alone.
  }
  session = remembered || openedFromStoreApp(document.referrer, location.search, inAppWindow())
  if (session && !remembered) {
    try {
      sessionStorage.setItem(STORE_SESSION_KEY, '1')
    } catch {}
  }
  return session
}

/** Whether prices, upsells and checkout are hidden: a store build or a store app's session. */
export function isStoreBuild(): boolean {
  if (process.env.NEXT_PUBLIC_STORE_BUILD === '1') return true
  return typeof window !== 'undefined' && storeSession()
}

/** Forgets the cached answer (tests). */
export function resetStoreBuildForTests(): void {
  session = undefined
}
