// The landing page's inline script, apart from lib/app-routes.ts so the app's bundles,
// which import the routes, never carry it.
import { ACCOUNT_OWNER_KEY, APP_PATH, STORE_SESSION_KEY } from './app-routes'

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
