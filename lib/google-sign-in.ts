// Google sign-in for components/GoogleSignInButton.tsx: the popup and the new account's
// first document. It loads on the button's first hover, focus or press (or with the
// button, where signing in is the screen's main action), so a guest's first load carries
// only the button (ROADMAP item 52).
import type { User } from 'firebase/auth'
import { isSignInCancelled } from './auth-errors'
import { loadFirebase } from './firebase'
import type { UserPreferences } from './types'

/** What a new account starts from: setup's answers, or the guest plan kept here. */
export interface SignInSeed {
  prefs: UserPreferences
  source: 'setup' | 'guest'
}

/**
 * Signs in with Google's popup and creates the account from `seed` if it does not exist
 * yet. Null when there is nothing to sign in with, or the person closed the popup
 * (their choice, not a failure); any other failure rejects.
 */
export async function signInWithGoogle(
  seed: SignInSeed | null | Promise<SignInSeed | null>,
): Promise<{ user: User; account: UserPreferences | null } | null> {
  try {
    const [services, { signInWithPopup }, start] = await Promise.all([
      loadFirebase(),
      import('firebase/auth'),
      seed,
    ])
    const auth = services?.auth
    const provider = services?.googleProvider
    if (!auth || !provider) return null
    const { user } = await signInWithPopup(auth, provider, services.popupRedirectResolver)
    if (!user) return null
    // Creates the account only if it does not exist yet, in one transaction, so a
    // returning account's saved document is never written here. The account document's
    // code loads after the popup, which needs the click's activation.
    const account = start
      ? await (
          await import('./account-prefs')
        ).createAccountPrefs(user.uid, start.prefs, start.source)
      : null
    return { user, account }
  } catch (error) {
    if (isSignInCancelled(error)) return null
    throw error
  }
}
