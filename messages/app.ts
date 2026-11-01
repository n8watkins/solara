// The app's frame: the header, the view tabs, the notices above the content, the
// loading and error states and the sign-in button. English, the source of truth;
// translations in ./es (docs/i18n/README.md).
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('app', {
  documentTitle: 'Solara: Plan around UV',
  signOutPaused:
    'Sign-out paused because notifications could not be disabled. Check your connection and try again.',
  signOutFailed: 'Could not sign out. Check your connection and try again.',
  currentUv: (value: string, level: string) => `Current UV index ${value}, ${level}`,
  pro: 'Pro',
  settings: 'Settings',
  signIn: 'Sign in',
  viewDashboard: 'Dashboard',
  viewDashboardHeading: 'UV dashboard',
  viewCalendar: 'Calendar',
  viewCalendarHeading: 'Activity calendar',
  forecastStale: (stamp: string) =>
    `Showing the forecast updated at ${stamp}. A newer one will load by itself.`,
  offlineWithForecast: (stamp: string) =>
    `You're offline. Showing the forecast updated at ${stamp}.`,
  offlineNoForecast: "You're offline. The forecast will load when you're back online.",
  offlineReadOnly: " You can make changes once you're back online.",
  accountLoadErrorTitle: 'Your account could not load',
  tryAgain: 'Try again',
  errorThisSection: 'this section',
  errorDashboard: 'the dashboard',
  errorCalendar: 'the calendar',
  errorTitle: (what: string) => `Something went wrong loading ${what}`,
  errorBody:
    'This usually clears up on a retry. If it keeps happening, your saved data may be out of date.',
  reloadApp: 'Reload app',
  continueWithGoogle: 'Continue with Google',
  signingIn: 'Signing in...',
  popupBlocked: 'Your browser blocked the sign-in window. Try again to continue.',
  signInFailed: 'Could not finish signing in. Try again.',
  /** Offline, or Google could not be reached (auth/network-request-failed). */
  signInNoConnection: 'Could not reach Google to sign in. Check your connection and try again.',
  /** A newer version is live and this tab already reloaded for it (lib/stale-build.ts). */
  signInUpdated: 'Solara was just updated. Reload the page to sign in.',
  /** The notice after this tab reloaded to a newer version (lib/stale-build.ts). */
  updatedReloaded: 'Solara was updated while this page was open, so it reloaded.',
  updatedReloadedSignIn:
    'Solara was updated while this page was open, so it reloaded. Choose Sign in again to continue.',
  notNow: 'Not now',
  loadingForecast: 'Loading the forecast…',
  dismiss: 'Dismiss',
  // Page titles, in the page's language once its translations arrive (lib/i18n.ts).
  titleAccount: 'Account Data Controls | Solara',
  titleShare: 'Shared Activity Window | Solara',
  titleNotFound: 'Page not found | Solara',
  morningSummaryReady: 'Your latest local-morning planning summary is ready.',
  retry: 'Retry',
  reload: 'Reload',
  retrySync: 'Retry sync',
})
