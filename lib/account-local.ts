// What account deletion clears in this browser (the account page, either deletion path).
// Loaded only by the account page.
import { clearGuestData } from './guest'
import { INSTALL_DISMISS_KEY } from './install-prompt'
import { clearLocalNotificationState } from './notifications'
import { clearAccountData } from './session'
import { THEME_STORAGE_KEY } from './theme'

/** Settings that belong to this browser, not to an account, and stay after a deletion. */
export const DEVICE_STORAGE_KEYS: readonly string[] = [THEME_STORAGE_KEY, INSTALL_DISMISS_KEY]

/** The notification service worker's record of shown deliveries (scripts/sw). */
export const DELIVERY_CACHE = 'solara-notification-deliveries-v1'

/**
 * After an account is deleted: removes everything Solara keeps in this browser for it,
 * so nothing of the account is left. That is the account data clearAccountData removes
 * (preferences, the forecast cache with its places, the account marker), any guest plan,
 * this device's notification registration and the record of the notifications it showed,
 * and every other `solara_` entry (upsell dismissals, the reapply timer). Only the device
 * settings in DEVICE_STORAGE_KEYS stay. Firestore keeps no copy on disk (memory cache) and
 * the app-shell service worker stores nothing account-specific; Auth clears its own
 * session when the user is deleted or signed out.
 *
 * Never throws: the account is already gone, so a failure here must not hide that.
 */
export async function clearDeletedAccount(uid: string): Promise<void> {
  try {
    clearAccountData()
    clearGuestData()
  } catch {}
  await clearLocalNotificationState(uid).catch(() => undefined)
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('solara_') && !DEVICE_STORAGE_KEYS.includes(key)) {
        localStorage.removeItem(key)
      }
    }
  } catch {}
  try {
    if (typeof caches !== 'undefined') await caches.delete(DELIVERY_CACHE)
  } catch {}
}
