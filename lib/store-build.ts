// The store build: Solara inside an app store listing (a Trusted Web Activity on Google
// Play now, the native app later) shows no price, upsell or checkout. Under Play's
// payments policy an app may let people use what they bought elsewhere, but must not sell
// or steer to a web purchase (docs/integrations/ANDROID.md, "consumption only"). Pro
// bought on the web still unlocks everything.
//
// It is on when the build sets NEXT_PUBLIC_STORE_BUILD=1, or at runtime for a session
// opened by an Android app: a TWA's first page has a referrer starting with
// `android-app://` (or its start URL carries `?source=twa`). The first page remembers it
// in sessionStorage, so later pages of the same session, whose referrer is the site
// itself, stay in store mode.

import { STORE_SESSION_KEY } from './app-routes'

export { STORE_SESSION_KEY }

/** Whether a page opened with this referrer and query string came from an app store app. */
export function openedFromStoreApp(referrer: string, search: string): boolean {
  return (
    referrer.startsWith('android-app://') || new URLSearchParams(search).get('source') === 'twa'
  )
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
  session = remembered || openedFromStoreApp(document.referrer, location.search)
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
