// Guest mode (decision D7): Solara works without signing in. A guest's plan lives
// only in this browser, under its own key, apart from the signed-in account's local
// copy (lib/prefs.ts), so the two can never be mistaken for each other. On the first
// sign-in the guest plan seeds a brand-new account (lib/prefs.ts newAccountPrefs);
// an account that already exists keeps its own plan, and the guest plan is dropped
// either way (lib/session.ts loadAccountPrefs).
//
// Reading the plan back goes through the preferences schema (lib/prefs.ts), except when
// the stored plan is already exactly what the schema would return (lib/stored-plan.ts),
// which is how this module writes it: then the schema, and Valibot with it, need not load
// for a returning guest's dashboard (ROADMAP item 52).
import { PREFS_SCHEMA_VERSION } from '@solara/core/prefs-rules'
import { TIER_LIMITS } from '@solara/core/tiers'
import { isStoredGuestPlan } from './stored-plan'
import type { UserPreferences } from './types'

export const GUEST_KEY = 'solara_guest'

interface GuestRecord {
  prefs: unknown
  /** The device-local day (YYYY-MM-DD) the guest first set Solara up. */
  since: string
}

/** Today in the device's own calendar, as YYYY-MM-DD. */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function readRecord(): GuestRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(GUEST_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('prefs' in parsed)) return null
    const since = (parsed as { since?: unknown }).since
    return {
      prefs: parsed.prefs,
      since: typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : localDay(),
    }
  } catch {
    return null
  }
}

/** A guest plan: never an account's, always on the guest tier and within its limits. */
export function asGuestPrefs(prefs: UserPreferences): UserPreferences {
  return {
    ...prefs,
    uid: '',
    tier: 'anonymous',
    activities: prefs.activities.slice(0, TIER_LIMITS.anonymous.activities),
    // Home plus 4 more places (ROADMAP item 54); home is kept apart, as `location`.
    savedLocations: prefs.savedLocations.slice(0, TIER_LIMITS.anonymous.savedLocations),
    profiles: undefined,
    activeProfileId: undefined,
    groupMode: undefined,
    groupProfileIds: undefined,
    upgradeInterest: undefined,
  }
}

/**
 * The guest plan kept in this browser, or null when there is none. The plan is read
 * from storage at once (before the first await); a plan in the form this module writes
 * is used as it is, and any other goes through the preferences schema, which loads for
 * it, and is then kept in that form (unless a newer version of Solara wrote it).
 */
export async function loadGuestPrefs(): Promise<UserPreferences | null> {
  const record = readRecord()
  if (!record) return null
  if (isStoredGuestPlan(record.prefs)) return record.prefs
  const { normalizePrefs } = await import('./prefs')
  const prefs = normalizePrefs(record.prefs)
  if (!prefs) return null
  const guest = asGuestPrefs(prefs)
  if (guest.schemaVersion === PREFS_SCHEMA_VERSION) saveGuestPrefs(guest)
  return guest
}

/**
 * Whether the guest plan kept here has activities, without reading it through the
 * schema: only a hint to fetch the activity plan's code early (components/App.tsx).
 */
export function guestPlanHasActivities(): boolean {
  const prefs = readRecord()?.prefs as { activities?: unknown } | undefined
  return Array.isArray(prefs?.activities) && prefs.activities.length > 0
}

/** Keeps the guest plan in this browser, remembering the day it was first saved. */
export function saveGuestPrefs(prefs: UserPreferences, today = localDay()): void {
  if (typeof window === 'undefined') return
  const since = readRecord()?.since ?? today
  const record: GuestRecord = { prefs: asGuestPrefs(prefs), since }
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(record))
  } catch {}
}

/** Removes the guest plan from this browser. */
export function clearGuestData(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(GUEST_KEY)
  } catch {}
}

/** Whether a guest set Solara up on an earlier day and has come back. */
export function isReturningGuest(today = localDay()): boolean {
  const since = readRecord()?.since
  return !!since && since < today
}
