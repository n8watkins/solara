// Account boundaries on a shared browser. Solara keeps a few things in
// localStorage next to Firebase Auth's own session: the last-used preferences,
// the weather cache and per-account notification state. None of it may carry over
// from one account to the next, whether the previous person signed out or their
// session simply ended.
import { loadedFirebase } from './firebase'
import { clearWeatherCache } from './cache'
import { clearLocalNotificationState, disableNotifications } from './notifications'
import { clearGuestData, loadGuestPrefs } from './guest'
import { clearLocalPrefs, createAccountPrefs, loadFirestorePrefs, loadLocalPrefs } from './prefs'
import { ACCOUNT_OWNER_KEY } from './app-routes'
import type { UserPreferences } from './types'

/** Sign-out stopped because this device could not be unsubscribed from notifications. */
export class SignOutBlockedError extends Error {
  constructor(cause: unknown) {
    super('Notifications could not be disabled on this device', { cause })
    this.name = 'SignOutBlockedError'
  }
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(uid: string): void {
  try {
    localStorage.setItem(ACCOUNT_OWNER_KEY, uid)
  } catch {}
}

/** Removes every piece of account data Solara keeps in this browser outside Firebase Auth. */
export function clearAccountData(): void {
  clearLocalPrefs()
  clearWeatherCache()
  try {
    localStorage.removeItem(ACCOUNT_OWNER_KEY)
  } catch {}
}

/**
 * The only supported way to sign out. Turns off notifications for this device
 * first (and stops with `SignOutBlockedError` if that fails, so the device never
 * keeps receiving the account's notifications), then clears local account data
 * and ends the Firebase session.
 */
export async function signOutAndClear(uid: string | null | undefined): Promise<void> {
  if (uid) {
    try {
      await disableNotifications(uid)
    } catch (error) {
      throw new SignOutBlockedError(error)
    }
  }
  clearAccountData()
  clearGuestData()
  // Someone signed in has Firebase loaded; with nothing loaded there is no session.
  const auth = loadedFirebase()?.auth
  if (auth) {
    const { signOut } = await import('firebase/auth')
    await signOut(auth)
  }
}

/**
 * Called when `uid` signs in. If the data stored in this browser belongs to a
 * different account (for example because that session expired instead of signing
 * out), it is discarded before anything reads it.
 */
export async function claimLocalData(uid: string): Promise<void> {
  const owner = readOwner()
  const localOwner = loadLocalPrefs()?.uid || null
  const previous = [owner, localOwner].find(id => id && id !== uid)
  if (previous) {
    clearAccountData()
    await clearLocalNotificationState(previous).catch(error =>
      console.error('Could not clear the previous account notification state:', error),
    )
  }
  writeOwner(uid)
}

export type AccountLoadResult =
  | { status: 'ready'; prefs: UserPreferences }
  | { status: 'needs-onboarding' }
  | { status: 'error'; stage: 'load' | 'create'; error: Error }

/**
 * Loads the signed-in account's preferences. A brand-new account is created from the
 * guest plan kept in this browser (lib/guest.ts), else from setup answers left here
 * that were never tied to another account; with neither, the person goes through
 * setup. An account that already exists always keeps its own plan.
 *
 * Once an account is ready, the guest plan is removed from this browser: it carried
 * over into a new account or gave way to an existing one, and either way no later
 * account on this device may inherit it.
 *
 * `signedIn` is the account document as sign-in read or created it in its
 * `createAccountPrefs` transaction. When it belongs to `uid` it is used as is: reading
 * the document again could be answered by a Firestore listen that started before that
 * transaction committed (the auth listener's own load), which still reports a brand-new
 * account as missing.
 */
export async function loadAccountPrefs(
  uid: string,
  signedIn?: UserPreferences | null,
): Promise<AccountLoadResult> {
  const result = await loadOrCreateAccount(uid, signedIn)
  if (result.status === 'ready') clearGuestData()
  return result
}

async function loadOrCreateAccount(
  uid: string,
  signedIn?: UserPreferences | null,
): Promise<AccountLoadResult> {
  await claimLocalData(uid)
  if (signedIn?.uid === uid) return { status: 'ready', prefs: signedIn }
  const result = await loadFirestorePrefs(uid)
  if (result.status === 'error') return { status: 'error', stage: 'load', error: result.error }
  if (result.status === 'found') return { status: 'ready', prefs: result.prefs }

  const guest = loadGuestPrefs()
  const local = loadLocalPrefs()
  const seed = guest ?? (local && (!local.uid || local.uid === uid) ? local : null)
  if (!seed) return { status: 'needs-onboarding' }
  try {
    return {
      status: 'ready',
      prefs: await createAccountPrefs(uid, seed, guest ? 'guest' : 'setup'),
    }
  } catch (error) {
    return {
      status: 'error',
      stage: 'create',
      error: error instanceof Error ? error : new Error('Could not create the account'),
    }
  }
}
