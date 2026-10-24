// Which top-level screen components/App.tsx shows while the account loads. Auth and
// setup events can land in any order, so each transition looks at the screen
// already showing rather than replacing it blindly.

export type AppScreen = 'loading' | 'welcome' | 'onboarding' | 'dashboard'

export const ACCOUNT_LOAD_ERROR =
  'Could not load your saved account. Nothing was changed. Check your connection and try again.'
export const ACCOUNT_CREATE_ERROR =
  'Could not finish setting up your account. Nothing was saved. Check your connection and try again.'

/** Signed out: back to welcome, unless the visitor is partway through setup. */
export function screenWhenSignedOut(prev: AppScreen): AppScreen {
  return prev === 'onboarding' ? prev : 'welcome'
}

/**
 * Signed in with no saved account yet (mid-onboarding): keep setup visible, and keep
 * the dashboard if setup already finished while this was loading.
 */
export function screenWhenNeedsOnboarding(prev: AppScreen): AppScreen {
  return prev === 'onboarding' || prev === 'dashboard' ? prev : 'welcome'
}

/** Setup finished: load the saved account, unless the dashboard is already up. */
export function screenAfterOnboarding(prev: AppScreen): AppScreen {
  return prev === 'dashboard' ? prev : 'loading'
}

export function accountErrorMessage(stage: 'load' | 'create'): string {
  return stage === 'create' ? ACCOUNT_CREATE_ERROR : ACCOUNT_LOAD_ERROR
}
