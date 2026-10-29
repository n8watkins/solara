// Where things live: the static landing page is `/`, the app is `/app/`.
// Free of Firebase and React so the landing page can use it.

/** The app. */
export const APP_PATH = '/app/'

/** The app's query flag that opens the sign-in screen (the landing page's "Sign in"). */
export const SIGN_IN_PARAM = 'signin'

/** After sign-out, the visitor lands on the landing page with nothing left in memory. */
export function goToLanding(): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- A full page load on purpose: it drops everything the signed-out account left in memory.
  window.location.assign('/')
}

/** The landing page's "Sign in" target. */
export const SIGN_IN_PATH = `${APP_PATH}?${SIGN_IN_PARAM}`

/**
 * Marks this browser as holding a signed-in account's data: written on every sign-in
 * and removed on sign-out (lib/session.ts).
 */
export const ACCOUNT_OWNER_KEY = 'solara_account_owner'

/** sessionStorage key for a session opened by an app store app (lib/store-build.ts). */
export const STORE_SESSION_KEY = 'solara_store_session'
