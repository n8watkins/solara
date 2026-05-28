import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { UserPreferences, Location, Activity, SkinType, TierLevel, PreferredHours } from './types'
import { PRESET_ACTIVITIES, ACTIVITY_CATEGORIES } from './tiers'

const PREFS_KEY = 'solara_prefs'
export const PREFS_SCHEMA_VERSION = 2

const SKIN_TYPES: SkinType[] = ['very-fair', 'fair', 'medium', 'olive', 'dark']
const TIERS: TierLevel[] = ['anonymous', 'free', 'paid']
const PRESET_IDS = new Set(PRESET_ACTIVITIES.map(a => a.id))
const CATEGORY_NAMES = new Set(ACTIVITY_CATEGORIES.map(c => c.name))

function isLocation(value: unknown): value is Location {
  const loc = value as Partial<Location> | null
  return !!loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' && typeof loc.city === 'string'
}

function normalizeStringList(raw: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(
    raw
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
      .filter(v => !allowed || allowed.has(v))
  ))
}

function normalizePreferredHours(raw: unknown): PreferredHours | undefined {
  const hours = raw as Partial<PreferredHours> | null
  if (!hours || typeof hours.from !== 'number' || typeof hours.to !== 'number') return undefined
  const from = Math.max(0, Math.min(23, Math.round(hours.from)))
  const to = Math.max(from + 1, Math.min(24, Math.round(hours.to)))
  return { from, to }
}

function normalizeActivity(raw: unknown, index: number, globalSunscreen: boolean): Activity | null {
  const a = raw as Partial<Activity> | null
  if (!a || typeof a.name !== 'string') return null

  const preset = typeof a.id === 'string'
    ? PRESET_ACTIVITIES.find(p => p.id === a.id)
    : undefined

  const durationMins = typeof a.durationMins === 'number'
    ? Math.max(5, Math.round(a.durationMins))
    : preset?.durationMins ?? 30

  const maxUV = typeof a.maxUV === 'number'
    ? Math.max(0, Math.min(11, a.maxUV))
    : preset?.maxUV ?? 4

  return {
    id: typeof a.id === 'string' && a.id.trim() ? a.id : `migrated_${index}`,
    name: a.name.trim() || preset?.name || 'Outdoor activity',
    icon: typeof a.icon === 'string' && a.icon.trim() ? a.icon : preset?.icon ?? '☀️',
    durationMins,
    maxUV,
    sunscreen: typeof a.sunscreen === 'boolean' ? a.sunscreen : globalSunscreen,
    custom: a.custom === true || a.id?.startsWith('custom_') || undefined,
    preferredHours: normalizePreferredHours(a.preferredHours),
  }
}

export function normalizePrefs(raw: Partial<UserPreferences> | null, fallbackLocation?: Location): UserPreferences | null {
  if (!raw) return null
  const location = isLocation(raw.location) ? raw.location : fallbackLocation
  if (!location) return null

  const sunscreen = typeof raw.sunscreen === 'boolean' ? raw.sunscreen : false
  const activities = Array.isArray(raw.activities)
    ? raw.activities.map((a, i) => normalizeActivity(a, i, sunscreen)).filter(Boolean) as Activity[]
    : []

  return {
    ...defaultPrefs(location),
    ...raw,
    uid: typeof raw.uid === 'string' ? raw.uid : '',
    schemaVersion: PREFS_SCHEMA_VERSION,
    location,
    skinType: SKIN_TYPES.includes(raw.skinType as SkinType) ? raw.skinType as SkinType : 'fair',
    sunscreen,
    activities,
    tier: TIERS.includes(raw.tier as TierLevel) ? raw.tier as TierLevel : 'anonymous',
    onboardingComplete: raw.onboardingComplete === true,
    calendarHours: raw.calendarHours && typeof raw.calendarHours.from === 'number' && typeof raw.calendarHours.to === 'number'
      ? { from: Math.max(0, Math.min(23, raw.calendarHours.from)), to: Math.max(1, Math.min(24, raw.calendarHours.to)) }
      : undefined,
    hiddenActivitySuggestionIds: normalizeStringList(raw.hiddenActivitySuggestionIds, PRESET_IDS),
    collapsedActivityCategories: normalizeStringList(raw.collapsedActivityCategories, CATEGORY_NAMES),
    upgradeInterest: raw.upgradeInterest,
  }
}

export function loadLocalPrefs(): UserPreferences | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<UserPreferences> : null
    const normalized = normalizePrefs(parsed)
    if (normalized && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      saveLocalPrefs(normalized)
    }
    return normalized
  } catch {
    try { localStorage.removeItem(PREFS_KEY) } catch {}
    return null
  }
}

export function saveLocalPrefs(prefs: Partial<UserPreferences>): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, schemaVersion: PREFS_SCHEMA_VERSION }))
}

export async function loadFirestorePrefs(uid: string): Promise<UserPreferences | null> {
  if (!db) return null
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    return snap.exists() ? normalizePrefs(snap.data() as Partial<UserPreferences>) : null
  } catch { return null }
}

export async function saveFirestorePrefs(uid: string, prefs: Partial<UserPreferences>): Promise<void> {
  if (!db) return
  const ref = doc(db, 'users', uid)
  const normalized = normalizePrefs({ ...prefs, uid }) ?? ({ uid, ...prefs, schemaVersion: PREFS_SCHEMA_VERSION } as Partial<UserPreferences>)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    await updateDoc(ref, { ...normalized })
  } else {
    await setDoc(ref, { ...normalized, uid })
  }
}

export function defaultPrefs(location: Location): UserPreferences {
  return {
    uid: '',
    schemaVersion: PREFS_SCHEMA_VERSION,
    location,
    skinType: 'fair',
    sunscreen: false,
    activities: [],
    tier: 'anonymous',
    onboardingComplete: false,
    hiddenActivitySuggestionIds: [],
    collapsedActivityCategories: [],
  }
}
