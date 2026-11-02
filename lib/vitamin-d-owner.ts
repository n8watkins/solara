// Whose vitamin D log is whose on this device (ROADMAP item 48), read by the log
// (lib/vitamin-d-log.ts), sign-in (lib/session.ts) and account deletion
// (lib/account-local.ts); the switch is apart, in lib/vitamin-d-switch.ts.
//
// The log is kept per owner on this device: a guest's under VITAMIN_D_LOG_KEY, each
// account's under its own key. Signing out or another account signing in only hides it
// (each reads its own key), signing back in shows it again, and a guest who signs in
// hands the guest log to the account (adoptGuestVitaminDLog). Deleting the account
// removes its log (lib/account-local.ts) and keeps other accounts' logs.

/** The guest's log; an account's is this key with its uid after ACCOUNT_KEY_SEPARATOR. */
export const VITAMIN_D_LOG_KEY = 'solara_vitamin_d_log'
const ACCOUNT_KEY_SEPARATOR = ':'

/** Whose log: an account's uid, or null for a guest. */
export type LogOwner = string | null

/** Where `owner`'s log lives in this browser (a `solara_` key). */
export function vitaminDLogKey(owner: LogOwner): string {
  return owner ? `${VITAMIN_D_LOG_KEY}${ACCOUNT_KEY_SEPARATOR}${owner}` : VITAMIN_D_LOG_KEY
}

/** The account a key holds the log of, null for the guest's, undefined when it is no log. */
export function vitaminDLogOwner(key: string): LogOwner | undefined {
  if (key === VITAMIN_D_LOG_KEY) return null
  const prefix = `${VITAMIN_D_LOG_KEY}${ACCOUNT_KEY_SEPARATOR}`
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : undefined
}

/** Removes `owner`'s log from this browser ("Delete all", the account's deletion). */
export function clearVitaminDLog(owner: LogOwner): void {
  try {
    localStorage.removeItem(vitaminDLogKey(owner))
  } catch {}
}

function storedEntries(raw: string | null): unknown[] {
  if (!raw) return []
  try {
    const entries = (JSON.parse(raw) as { entries?: unknown } | null)?.entries
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/**
 * A guest who signs in hands the guest log to the account: its entries join the account's
 * own on this device (both kept; the log checks and prunes them when it next reads them)
 * and the guest's key is removed, so no later guest on this device sees them.
 */
export function adoptGuestVitaminDLog(uid: string): void {
  try {
    const guest = localStorage.getItem(VITAMIN_D_LOG_KEY)
    if (guest === null) return
    const key = vitaminDLogKey(uid)
    const entries = [...storedEntries(localStorage.getItem(key)), ...storedEntries(guest)]
    if (entries.length > 0) localStorage.setItem(key, JSON.stringify({ version: 1, entries }))
    localStorage.removeItem(VITAMIN_D_LOG_KEY)
  } catch {}
}
