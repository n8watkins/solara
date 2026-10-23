import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type {
  UserPreferences,
  Location,
  Activity,
  SkinType,
  TierLevel,
  PreferredHours,
  Profile,
} from './types'
import { PRESET_ACTIVITIES, ACTIVITY_CATEGORIES } from './tiers'

const PREFS_KEY = 'solara_prefs'
export const PREFS_SCHEMA_VERSION = 2

const SKIN_TYPES: SkinType[] = ['very-fair', 'fair', 'medium', 'olive', 'dark']
const TIERS: TierLevel[] = ['anonymous', 'free', 'paid']
const PRESET_IDS = new Set(PRESET_ACTIVITIES.map(a => a.id))
const CATEGORY_NAMES = new Set(ACTIVITY_CATEGORIES.map(c => c.name))

function isLocation(value: unknown): value is Location {
  const loc = value as Partial<Location> | null
  return (
    !!loc &&
    Number.isFinite(loc.lat) &&
    loc.lat! >= -90 &&
    loc.lat! <= 90 &&
    Number.isFinite(loc.lon) &&
    loc.lon! >= -180 &&
    loc.lon! <= 180 &&
    typeof loc.city === 'string'
  )
}

function normalizeLocation(value: Location): Location {
  return {
    lat: value.lat,
    lon: value.lon,
    city: value.city.trim().slice(0, 120),
    region: typeof value.region === 'string' ? value.region.trim().slice(0, 120) : '',
    timezone:
      typeof value.timezone === 'string' &&
      /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(value.timezone)
        ? value.timezone
        : undefined,
  }
}

function sameLocation(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

/**
 * Validated saved-location shortcuts: deduped by rounded lat/lon and hard-capped at
 * the top tier's limit so the list can't grow unbounded. The active location is NOT
 * forced in here — it's pinned separately in the UI, so changing your one location
 * is never gated; only saving extra shortcuts is.
 */
function normalizeSavedLocations(raw: unknown): Location[] {
  const list = Array.isArray(raw) ? raw.filter(isLocation) : []
  const out: Location[] = []
  for (const loc of list) {
    const normalized = normalizeLocation(loc)
    if (!out.some(l => sameLocation(l, normalized))) out.push(normalized)
  }
  return out.slice(0, 12)
}

/** Validated profiles: each needs a name + valid skin type; deduped by id, capped. */
function normalizeProfiles(raw: unknown): Profile[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Profile[] = []
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] as Partial<Profile> | null
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue
    if (!SKIN_TYPES.includes(p.skinType as SkinType)) continue
    const id = typeof p.id === 'string' && p.id.trim() ? p.id : `profile_${i}`
    if (out.some(e => e.id === id)) continue
    out.push({
      id,
      name: p.name.trim().slice(0, 40),
      skinType: p.skinType as SkinType,
      icon: typeof p.icon === 'string' && p.icon.trim() ? p.icon : undefined,
    })
  }
  return out.length ? out.slice(0, 12) : undefined
}

/** The live-feed token must be a long, URL-safe secret. Reject anything weaker. */
function normalizeFeedToken(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(raw) ? raw : undefined
}

function normalizeStringList(raw: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(
    new Set(
      raw
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map(v => v.trim())
        .filter(v => !allowed || allowed.has(v)),
    ),
  )
}

function normalizeUpgradeInterest(raw: unknown): UserPreferences['upgradeInterest'] {
  const interest = raw as Partial<NonNullable<UserPreferences['upgradeInterest']>> | null
  if (
    !interest ||
    typeof interest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(interest.createdAt))
  ) {
    return undefined
  }
  return {
    email:
      typeof interest.email === 'string' && interest.email.trim()
        ? interest.email.trim().slice(0, 254)
        : undefined,
    createdAt: interest.createdAt,
  }
}

function normalizePreferredHours(raw: unknown): PreferredHours | undefined {
  const hours = raw as Partial<PreferredHours> | null
  if (!hours || typeof hours.from !== 'number' || typeof hours.to !== 'number') return undefined
  const from = Math.max(0, Math.min(23, Math.round(hours.from)))
  const to = Math.max(from + 1, Math.min(24, Math.round(hours.to)))
  return { from, to }
}

/** Whole-day restriction: a sorted, deduped subset of 0–6. Undefined = every day. */
function normalizeDaysOfWeek(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const days = Array.from(
    new Set(
      raw.filter(
        (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
      ),
    ),
  ).sort((a, b) => a - b)
  // Empty or all-seven means "every day" — store nothing so the field stays clean.
  return days.length === 0 || days.length === 7 ? undefined : days
}

function normalizeActivity(raw: unknown, index: number, globalSunscreen: boolean): Activity | null {
  const a = raw as Partial<Activity> | null
  if (!a || typeof a.name !== 'string') return null

  const preset = typeof a.id === 'string' ? PRESET_ACTIVITIES.find(p => p.id === a.id) : undefined

  const durationMins =
    typeof a.durationMins === 'number'
      ? Math.max(5, Math.round(a.durationMins))
      : (preset?.durationMins ?? 30)

  const maxUV =
    typeof a.maxUV === 'number' ? Math.max(0, Math.min(11, a.maxUV)) : (preset?.maxUV ?? 4)

  return {
    id: typeof a.id === 'string' && a.id.trim() ? a.id : `migrated_${index}`,
    name: a.name.trim() || preset?.name || 'Outdoor activity',
    icon: typeof a.icon === 'string' && a.icon.trim() ? a.icon : (preset?.icon ?? '☀️'),
    durationMins,
    maxUV,
    sunscreen: typeof a.sunscreen === 'boolean' ? a.sunscreen : globalSunscreen,
    custom: a.custom === true || a.id?.startsWith('custom_') || undefined,
    preferredHours: normalizePreferredHours(a.preferredHours),
    timePreference:
      a.timePreference === 'latest' || a.timePreference === 'sunniest'
        ? a.timePreference
        : undefined,
    daysOfWeek: normalizeDaysOfWeek(a.daysOfWeek),
    cloudSensitive: a.cloudSensitive === true ? true : undefined,
  }
}

export function normalizePrefs(
  raw: Partial<UserPreferences> | null,
  fallbackLocation?: Location,
): UserPreferences | null {
  if (!raw) return null
  const rawLocation = isLocation(raw.location)
    ? raw.location
    : isLocation(fallbackLocation)
      ? fallbackLocation
      : undefined
  const location = rawLocation ? normalizeLocation(rawLocation) : undefined
  if (!location) return null

  const sunscreen = typeof raw.sunscreen === 'boolean' ? raw.sunscreen : false
  const profiles = normalizeProfiles(raw.profiles)
  const activities = Array.isArray(raw.activities)
    ? (raw.activities
        .map((a, i) => normalizeActivity(a, i, sunscreen))
        .filter(Boolean) as Activity[])
    : []

  return {
    uid: typeof raw.uid === 'string' ? raw.uid : '',
    schemaVersion: PREFS_SCHEMA_VERSION,
    location,
    savedLocations: normalizeSavedLocations(raw.savedLocations),
    profiles,
    activeProfileId: profiles?.some(p => p.id === raw.activeProfileId)
      ? raw.activeProfileId
      : undefined,
    skinType: SKIN_TYPES.includes(raw.skinType as SkinType) ? (raw.skinType as SkinType) : 'fair',
    sunscreen,
    activities,
    tier: TIERS.includes(raw.tier as TierLevel) ? (raw.tier as TierLevel) : 'anonymous',
    calendarFeedToken: normalizeFeedToken(raw.calendarFeedToken),
    onboardingComplete: raw.onboardingComplete === true,
    calendarHours:
      raw.calendarHours &&
      typeof raw.calendarHours.from === 'number' &&
      typeof raw.calendarHours.to === 'number'
        ? {
            from: Math.max(0, Math.min(23, raw.calendarHours.from)),
            to: Math.max(1, Math.min(24, raw.calendarHours.to)),
          }
        : undefined,
    showSunPath: typeof raw.showSunPath === 'boolean' ? raw.showSunPath : undefined,
    hiddenActivitySuggestionIds: normalizeStringList(raw.hiddenActivitySuggestionIds, PRESET_IDS),
    collapsedActivityCategories: normalizeStringList(
      raw.collapsedActivityCategories,
      CATEGORY_NAMES,
    ),
    upgradeInterest: normalizeUpgradeInterest(raw.upgradeInterest),
    notificationHour:
      typeof raw.notificationHour === 'number'
        ? Math.max(5, Math.min(10, Math.round(raw.notificationHour)))
        : 7,
  }
}

export function loadLocalPrefs(): UserPreferences | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<UserPreferences>) : null
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

export function saveLocalPrefs(prefs: Partial<UserPreferences>): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, schemaVersion: PREFS_SCHEMA_VERSION }))
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
  if (!db) return { status: 'error', error: new Error('Firebase is not configured') }
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return { status: 'missing' }
    const prefs = normalizePrefs(snap.data() as Partial<UserPreferences>)
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

/**
 * The preferences a brand-new account starts with: defaults plus the answers the
 * person gave during onboarding (location, skin type, onboarding flag), owned by
 * `uid` on the free tier. Everything else in `seed` is ignored on purpose, so a new
 * account can never inherit another account's activities, profiles, tier or
 * calendar feed token from data left on a shared device.
 */
export function newAccountPrefs(
  uid: string,
  seed: Partial<UserPreferences>,
): UserPreferences | null {
  const answers = normalizePrefs(seed)
  if (!answers) return null
  return {
    ...defaultPrefs(answers.location),
    uid,
    tier: 'free',
    skinType: answers.skinType,
    onboardingComplete: answers.onboardingComplete,
  }
}

/**
 * Creates the account document from onboarding answers (see `newAccountPrefs`).
 * Runs as a transaction so two concurrent seeders never overwrite each other: if
 * the document already exists, it is returned unchanged. Throws if the write fails
 * or the seed has no valid location.
 */
export async function createAccountPrefs(
  uid: string,
  seed: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const fresh = newAccountPrefs(uid, seed)
  if (!fresh) throw new Error('Onboarding answers are missing a valid location')
  if (!db) return fresh
  const ref = doc(db, 'users', uid)
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (snap.exists()) {
      const existing = normalizePrefs(snap.data() as Partial<UserPreferences>)
      if (!existing) throw new Error('Saved preferences are invalid')
      return existing
    }
    tx.set(ref, { ...fresh })
    return fresh
  })
}

/**
 * Saves preferences to the account document. If the document does not exist yet,
 * it is created from onboarding answers only (see `createAccountPrefs`).
 */
export async function saveFirestorePrefs(
  uid: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  if (!db) return
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await createAccountPrefs(uid, prefs)
    return
  }
  const normalized =
    normalizePrefs({ ...prefs, uid }) ??
    ({ uid, ...prefs, schemaVersion: PREFS_SCHEMA_VERSION } as Partial<UserPreferences>)
  await updateDoc(ref, { ...normalized })
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
