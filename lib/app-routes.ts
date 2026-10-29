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

/**
 * The landing page's only script, inline and run before the page paints: a browser
 * with a Solara account goes straight to the app, so bookmarks of `/` from before the
 * app moved to `/app/` (and Stripe or notification links to `/`) keep working. The
 * query and hash are kept. Anything that goes wrong leaves the landing page as is.
 *
 * A session opened by an app store app (a Trusted Web Activity: its referrer starts
 * with `android-app://`, or `?source=twa`) also goes to the app, and is remembered as
 * lib/store-build.ts does, because the landing page shows prices a store listing may
 * not; a store build (NEXT_PUBLIC_STORE_BUILD=1) always goes to the app.
 */
export const LANDING_REDIRECT_SCRIPT =
  process.env.NEXT_PUBLIC_STORE_BUILD === '1'
    ? `location.replace(${JSON.stringify(APP_PATH)}+location.search+location.hash)`
    : `try{var k=${JSON.stringify(STORE_SESSION_KEY)};if(document.referrer.indexOf("android-app://")===0||/[?&]source=twa(&|$)/.test(location.search))sessionStorage.setItem(k,"1");if(localStorage.getItem(${JSON.stringify(ACCOUNT_OWNER_KEY)})||sessionStorage.getItem(k)==="1")location.replace(${JSON.stringify(APP_PATH)}+location.search+location.hash)}catch(e){}`
