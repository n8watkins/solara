// Account boundaries on a shared browser. Solara keeps a few things in
// localStorage next to Firebase Auth's own session: the last-used preferences,
// the weather cache and per-account notification state. None of it may carry over
// from one account to the next, whether the previous person signed out or their
// session simply ended.
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { clearWeatherCache } from './cache'
import { clearLocalNotificationState, disableNotifications } from './notifications'
import { clearLocalPrefs, createAccountPrefs, loadFirestorePrefs, loadLocalPrefs } from './prefs'
import type { UserPreferences } from './types'

/** Remembers which account the locally stored data belongs to. */
const ACCOUNT_OWNER_KEY = 'solara_account_owner'

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
  if (auth) await signOut(auth)
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
 * Loads the signed-in account's preferences. A brand-new account is created from
 * onboarding answers left in this browser, but only answers that were never tied to
 * another account; anything else sends the person through onboarding.
 */
export async function loadAccountPrefs(uid: string): Promise<AccountLoadResult> {
  await claimLocalData(uid)
  const result = await loadFirestorePrefs(uid)
  if (result.status === 'error') return { status: 'error', stage: 'load', error: result.error }
  if (result.status === 'found') return { status: 'ready', prefs: result.prefs }

  const local = loadLocalPrefs()
  if (!local || (local.uid && local.uid !== uid)) return { status: 'needs-onboarding' }
  try {
    return { status: 'ready', prefs: await createAccountPrefs(uid, local) }
  } catch (error) {
    return {
      status: 'error',
      stage: 'create',
      error: error instanceof Error ? error : new Error('Could not create the account'),
    }
  }
}
