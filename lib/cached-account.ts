// The signed-in account as this browser last saw it, so a returning person sees their
// dashboard at once while Firebase loads and confirms the session (lib/use-account.ts).
import { ACCOUNT_OWNER_KEY } from './app-routes'
import { storedSessionUser, type StoredSessionUser } from './firebase'
import { loadLocalPrefs } from './prefs'
import type { UserPreferences } from './types'

export interface CachedAccount {
  /** The account as Auth keeps it for its session (name, email and photo for the header). */
  identity: StoredSessionUser
  /** The account's preferences as last loaded or saved on this browser. */
  prefs: UserPreferences
}

/**
 * The account to show before Auth has confirmed the session, or null. Only when three
 * records on this browser agree on one account: the marker every sign-in writes, the
 * user of the session Auth keeps, and the preferences copy, which carries its account's
 * uid. Sign-out removes all three, and a different account's sign-in replaces them
 * (lib/session.ts), so this never shows one account's plan to another; when Auth then
 * reports no session or another account, the app drops it (lib/use-account.ts).
 */
export async function cachedAccount(): Promise<CachedAccount | null> {
  let owner: string | null = null
  try {
    owner = localStorage.getItem(ACCOUNT_OWNER_KEY)
  } catch {}
  if (!owner) return null
  const prefs = loadLocalPrefs()
  if (prefs?.uid !== owner) return null
  const identity = await storedSessionUser()
  return identity?.uid === owner ? { identity, prefs } : null
}
