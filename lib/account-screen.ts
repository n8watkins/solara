// Which top-level screen components/App.tsx shows while the account loads. Auth and
// setup events can land in any order, so each transition looks at the screen
// already showing rather than replacing it blindly.

/**
 * - `loading`: the account (or the auth state) is loading.
 * - `signin`: the sign-in screen (the landing page's "Sign in").
 * - `onboarding`: setup (location and skin type).
 * - `dashboard`: the app, for an account or for a guest.
 */
export type AppScreen = 'loading' | 'signin' | 'onboarding' | 'dashboard'

export const ACCOUNT_LOAD_ERROR =
  'Could not load your saved account. Nothing was changed. Check your connection and try again.'
export const ACCOUNT_CREATE_ERROR =
  'Could not finish setting up your account. Nothing was saved. Check your connection and try again.'

/**
 * Signed out. A guest plan in this browser opens the guest dashboard; otherwise the
 * visitor starts setup, or the sign-in screen when they came to sign in. Setup and
 * the sign-in screen are never interrupted.
 */
export function screenWhenSignedOut(
  prev: AppScreen,
  { hasGuestPlan, signInRequested }: { hasGuestPlan: boolean; signInRequested: boolean },
): AppScreen {
  if (prev === 'onboarding' || prev === 'signin') return prev
  if (signInRequested && prev === 'loading') return 'signin'
  return hasGuestPlan ? 'dashboard' : 'onboarding'
}

/**
 * Signed in with no saved account yet: setup creates it. A dashboard that setup
 * already finished while this was loading stays.
 */
export function screenWhenNeedsOnboarding(prev: AppScreen): AppScreen {
  return prev === 'dashboard' ? prev : 'onboarding'
}

/** Sign-in or setup finished: load the saved account, unless the dashboard already shows it. */
export function screenAfterOnboarding(prev: AppScreen): AppScreen {
  return prev === 'dashboard' ? prev : 'loading'
}

export function accountErrorMessage(stage: 'load' | 'create'): string {
  return stage === 'create' ? ACCOUNT_CREATE_ERROR : ACCOUNT_LOAD_ERROR
}
