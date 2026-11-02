// The account document in Firestore (users/{uid}): reading it, creating it for a new
// account from setup answers or a guest plan, and saving Settings to it. Apart from
// lib/prefs.ts (the browser copy), so a guest's first load never carries it; Firestore
// itself loads on demand (lib/firebase.ts).
import {
  clientPreferencesUpdate,
  isWritablePreferences,
  NewerPreferencesVersionError,
} from '@solara/core'
import { samePlace } from '@solara/core/coordinates'
import { TIER_LIMITS } from '@solara/core/tiers'
import { loadFirebase } from './firebase'
import { defaultPrefs } from './local-prefs'
import { normalizePrefs } from './prefs'
import type { UserPreferences } from './types'

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
 * also the activities and saved places (within the free plan), sunscreen, units and
 * display choices. Profiles, tier and waitlist state never carry over.
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
    // Home counts toward the limit (ROADMAP item 53).
    savedLocations: answers.savedLocations
      .filter(place => !samePlace(place, answers.location))
      .slice(0, TIER_LIMITS.free.savedLocations - 1),
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
