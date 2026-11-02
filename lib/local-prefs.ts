// The signed-in account's copy in this browser (read and normalized by lib/prefs.ts
// loadLocalPrefs), and a new plan's defaults: what the first screen needs without the
// preferences schema, which stays out of a guest's first load (ROADMAP item 52).
import { PREFS_SCHEMA_VERSION } from '@solara/core/prefs-rules'
import type { UserPreferences, Location } from './types'

export const PREFS_KEY = 'solara_prefs'

/** The account's copy as stored in this browser, unread (lib/prefs.ts loadLocalPrefs reads it). */
export function storedLocalPrefs(): unknown {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Stores preferences in this browser. Preferences read from a newer schema version
 * are not written back, so this client never downgrades them.
 *
 * Never throws: the copy here is only a cache of the account, so full or blocked
 * storage must not stop the account write that follows.
 */
export function saveLocalPrefs(prefs: Partial<UserPreferences>): void {
  if (typeof window === 'undefined') return
  if ((prefs.schemaVersion ?? 0) > PREFS_SCHEMA_VERSION) return
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...prefs, schemaVersion: PREFS_SCHEMA_VERSION }),
    )
  } catch {}
}

export function clearLocalPrefs(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PREFS_KEY)
  } catch {}
}

export function defaultPrefs(location: Location): UserPreferences {
  return {
    uid: '',
    schemaVersion: PREFS_SCHEMA_VERSION,
    location,
    savedLocations: [],
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'anonymous',
    onboardingComplete: false,
    hiddenActivitySuggestionIds: [],
    collapsedActivityCategories: [],
    notificationHour: 7,
  }
}
