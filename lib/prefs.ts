import {
  clientPreferencesUpdate,
  isWritablePreferences,
  NewerPreferencesVersionError,
  parsePreferences,
  PREFS_SCHEMA_VERSION,
} from '@solara/core'
import { loadFirebase } from './firebase'
import type { UserPreferences, Location } from './types'
import { PRESET_ACTIVITIES, ACTIVITY_CATEGORIES, TIER_LIMITS } from './tiers'

// The document schema, its versions and migrations live in @solara/core
// (packages/core/src/prefs.ts). This module adds what depends on the app's activity
// catalog and does the storage: the browser copy and the Firestore account document.
// Firestore loads on demand (lib/firebase.ts), so the browser-copy half costs a guest
// nothing.

export { NewerPreferencesVersionError, PREFS_SCHEMA_VERSION }

const PREFS_KEY = 'solara_prefs'

const PRESETS = new Map(PRESET_ACTIVITIES.map(preset => [preset.id, preset]))
const CATEGORY_NAMES = new Set(ACTIVITY_CATEGORIES.map(category => category.name))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A preset activity with missing fields takes them from the catalog. */
function withPresetDefaults(raw: unknown): unknown {
  if (!isRecord(raw) || typeof raw.id !== 'string') return raw
  const preset = PRESETS.get(raw.id)
  if (!preset) return raw
  return {
    ...raw,
    name: typeof raw.name === 'string' && !raw.name.trim() ? preset.name : raw.name,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon : preset.icon,
    durationMins: typeof raw.durationMins === 'number' ? raw.durationMins : preset.durationMins,
    maxUV: typeof raw.maxUV === 'number' ? raw.maxUV : preset.maxUV,
  }
}

/**
 * Migrates and normalizes stored preferences (see `parsePreferences` in @solara/core),
 * filling preset activities from the catalog and keeping only suggestion ids and
 * category names the app knows. Returns null without a valid location or fallback.
 */
export function normalizePrefs(raw: unknown, fallbackLocation?: Location): UserPreferences | null {
  const input =
    isRecord(raw) && Array.isArray(raw.activities)
      ? { ...raw, activities: raw.activities.map(withPresetDefaults) }
      : raw
  const prefs = parsePreferences(input, { fallbackLocation })
  if (!prefs) return null
  prefs.hiddenActivitySuggestionIds = prefs.hiddenActivitySuggestionIds.filter(id =>
    PRESETS.has(id),
  )
  prefs.collapsedActivityCategories = prefs.collapsedActivityCategories.filter(name =>
    CATEGORY_NAMES.has(name),
  )
  return prefs
}

export function loadLocalPrefs(): UserPreferences | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const normalized = normalizePrefs(parsed)
    if (normalized && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      saveLocalPrefs(normalized)
    }
    return normalized
  } catch {
    try {
      localStorage.removeItem(PREFS_KEY)
    } catch {}
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

export type FirestorePrefsResult =
  | { status: 'found'; prefs: UserPreferences }
  | { status: 'missing' }
  | { status: 'error'; error: Error }

export async function loadFirestorePrefs(uid: string): Promise<FirestorePrefsResult> {
  try {
    const db = (await loadFirebase())?.db
    if (!db) return { status: 'error', error: new Error('Firebase is not configured') }
    const { doc, getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return { status: 'missing' }
    const prefs = normalizePrefs(snap.data())
    return prefs
      ? { status: 'found', prefs }
      : { status: 'error', error: new Error('Saved preferences are invalid') }
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error : new Error('Could not load saved preferences'),
    }
  }
}

/** Where a new account's starting answers come from. */
export type AccountSeedSource = 'setup' | 'guest'

/**
 * The preferences a brand-new account starts with: defaults plus the answers the
 * person gave during setup (location, skin type, onboarding flag), owned by `uid` on
 * the free tier. Everything else in a `setup` seed is ignored on purpose, so a new
 * account can never inherit another account's activities, profiles, tier or calendar
 * feed token from data left on a shared device.
 *
 * A `guest` seed is the guest plan this person built in this browser before signing
 * in (lib/guest.ts, which only ever holds guest data), so their plan carries over:
 * also the activities (within the free plan), sunscreen, units and display choices.
 * Saved places, profiles, tier and waitlist state never carry over.
 */
export function newAccountPrefs(
  uid: string,
  seed: unknown,
  source: AccountSeedSource = 'setup',
): UserPreferences | null {
  const answers = normalizePrefs(seed)
  if (!answers) return null
  const fresh: UserPreferences = {
    ...defaultPrefs(answers.location),
    uid,
    tier: 'free',
    skinType: answers.skinType,
    onboardingComplete: answers.onboardingComplete,
  }
  if (source !== 'guest') return fresh
  return {
    ...fresh,
    activities: answers.activities.slice(0, TIER_LIMITS.free.activities),
    sunscreen: answers.sunscreen,
    hiddenActivitySuggestionIds: answers.hiddenActivitySuggestionIds,
    collapsedActivityCategories: answers.collapsedActivityCategories,
    ...(answers.temperatureUnit && { temperatureUnit: answers.temperatureUnit }),
    ...(answers.clockFormat && { clockFormat: answers.clockFormat }),
    ...(answers.showSunPath !== undefined && { showSunPath: answers.showSunPath }),
    ...(answers.calendarHours && { calendarHours: answers.calendarHours }),
  }
}

/**
 * Creates the account document from setup answers or a guest plan (see
 * `newAccountPrefs`). Runs as a transaction so two concurrent seeders never overwrite
 * each other: if the document already exists, it is returned unchanged, so an
 * existing account never takes anything from the seed. Throws if the write fails or
 * the seed has no valid location.
 */
export async function createAccountPrefs(
  uid: string,
  seed: unknown,
  source: AccountSeedSource = 'setup',
): Promise<UserPreferences> {
  const fresh = newAccountPrefs(uid, seed, source)
  if (!fresh) throw new Error('Onboarding answers are missing a valid location')
  const db = (await loadFirebase())?.db
  if (!db) return fresh
  const { doc, runTransaction } = await import('firebase/firestore')
  const ref = doc(db, 'users', uid)
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (snap.exists()) {
      const existing = normalizePrefs(snap.data())
      if (!existing) throw new Error('Saved preferences are invalid')
      return existing
    }
    tx.set(ref, { ...fresh })
    return fresh
  })
}

/**
 * Saves preferences to the account document with one write of the client-owned fields
 * (`uid` and `tier` belong to the server once the account exists). If the document does
 * not exist yet, it is created from onboarding answers only (see `createAccountPrefs`).
 *
 * Throws NewerPreferencesVersionError for preferences read from a newer schema version.
 */
export async function saveFirestorePrefs(uid: string, prefs: UserPreferences): Promise<void> {
  const db = (await loadFirebase())?.db
  if (!db) return
  if (!isWritablePreferences(prefs)) throw new NewerPreferencesVersionError(prefs.schemaVersion)
  const normalized = normalizePrefs({ ...prefs, uid })
  if (!normalized) throw new Error('Preferences are missing a valid location')
  const [{ doc, getDoc, updateDoc }, { FirebaseError }] = await Promise.all([
    import('firebase/firestore'),
    import('firebase/app'),
  ])
  const ref = doc(db, 'users', uid)
  try {
    // updateDoc replaces the named top-level fields and never creates the document.
    // (A merging setDoc would deep-merge maps, keeping a stale location.timezone.)
    await updateDoc(ref, clientPreferencesUpdate(normalized))
  } catch (error) {
    // The rules deny an update of a missing document rather than reporting not-found,
    // so check before falling back to creating it.
    if (!(error instanceof FirebaseError) || error.code !== 'permission-denied') throw error
    if ((await getDoc(ref)).exists()) throw error
    await createAccountPrefs(uid, prefs)
  }
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
