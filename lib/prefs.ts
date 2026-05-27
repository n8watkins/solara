import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { UserPreferences, Location, Activity, SkinType } from './types'
import { DEFAULT_ACTIVITIES } from './weather'

const PREFS_KEY = 'solara_prefs'

export function loadLocalPrefs(): Partial<UserPreferences> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveLocalPrefs(prefs: Partial<UserPreferences>): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export async function loadFirestorePrefs(uid: string): Promise<UserPreferences | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    return snap.exists() ? (snap.data() as UserPreferences) : null
  } catch {
    return null
  }
}

export async function saveFirestorePrefs(uid: string, prefs: Partial<UserPreferences>): Promise<void> {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    await updateDoc(ref, { ...prefs })
  } else {
    await setDoc(ref, { uid, ...prefs })
  }
}

export function defaultPrefs(location: Location): UserPreferences {
  return {
    uid: '',
    location,
    skinType: 'fair',
    sunscreen: false,
    activities: DEFAULT_ACTIVITIES,
  }
}
