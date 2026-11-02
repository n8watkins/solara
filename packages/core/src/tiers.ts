// The three plans and what each includes: the one source of truth for plan limits.
// The web app (lib/tiers.ts re-exports this), the stored-preferences caps (prefs.ts
// PREFS_LIMITS) and a native client read it; firestore.rules repeat the list caps, and
// lib/firestore-rules.test.ts checks that they match.
import { PLAN_FORECAST_DAYS } from './plans'
import type { Activity, TierLevel } from './prefs'
import { effectiveMaxUV as sharedEffectiveMaxUV } from './recommendation'
import m from './messages/plans'

/** What each plan includes. Every tier rule in the app reads from here. */
export interface TierLimits {
  /** Activities the plan can hold. */
  activities: number
  /** Google Calendar booking, scheduled activities, the live feed and the .ics export. */
  calendar: boolean
  /** Pro's alerts: the personalised morning plan, UV alerts and event heads-ups. */
  notifications: boolean
  /**
   * The basic daily UV push ("Protect from 10:10am to 3:40pm today"), sent by the same
   * scheduled job once alerts are switched on (core daily-uv.ts). Pro's morning plan
   * takes its place for Pro.
   */
  dailyUvPush: boolean
  /**
   * The sunscreen reapply reminder as a push, so it arrives with Solara closed (a
   * safety feature, free with any account). The timer itself works on every plan.
   */
  reapplyPush: boolean
  /** Forecast days the plan can see, today included. */
  futureDays: number
  /**
   * Saved places, home included (ROADMAP item 53): home plus the places kept for quick
   * switching from the header's place menu.
   */
  savedLocations: number
  /** People the plan covers; more than one means family profiles. */
  profiles: number
  /** Where the plan lives: only in this browser, or synced through the account. */
  storage: 'device' | 'synced'
}

/**
 * The three plans (owner decision D7, 2026-10-23; tiers confirmed 2026-10-24):
 *
 * |                     | Guest (no sign-in) | Free account       | Pro     |
 * | ------------------- | ------------------ | ------------------ | ------- |
 * | Forecast            | Today              | Today and tomorrow | 10 days |
 * | Activities          | 1                  | 3                  | 20      |
 * | Storage             | This device only   | Synced             | Synced  |
 * | Calendar sync       | -                  | Yes                | Yes     |
 * | Daily UV push, reapply push | -          | Yes                | Yes     |
 * | Alerts, family profiles | -              | -                  | Yes     |
 */
export const TIER_LIMITS: Readonly<Record<TierLevel, TierLimits>> = {
  anonymous: {
    activities: 1,
    calendar: false,
    notifications: false,
    // Pushes need an account to reach: a guest's timer reminds in the open tab only.
    dailyUvPush: false,
    reapplyPush: false,
    futureDays: PLAN_FORECAST_DAYS.anonymous,
    // Home plus 4 more (default, owner may change, 2026-11-01): a traveller's few places
    // are a safety feature, so guests get as many as Free.
    savedLocations: 5,
    profiles: 1,
    storage: 'device',
  },
  free: {
    activities: 3,
    // Owner decision 2026-10-24: Google Calendar adding and Scheduled stay free.
    calendar: true,
    notifications: false,
    dailyUvPush: true,
    reapplyPush: true,
    futureDays: PLAN_FORECAST_DAYS.free,
    savedLocations: 5,
    profiles: 1,
    storage: 'synced',
  },
  paid: {
    activities: 20,
    calendar: true,
    notifications: true,
    dailyUvPush: true,
    reapplyPush: true,
    futureDays: PLAN_FORECAST_DAYS.paid,
    savedLocations: 12,
    profiles: 6,
    storage: 'synced',
  },
}

/** Display names for the plans. */
export const TIER_NAMES: Readonly<Record<TierLevel, string>> = {
  get anonymous() {
    return m.tierGuest
  },
  get free() {
    return m.tierFree
  },
  get paid() {
    return m.tierPro
  },
}

export function canAddActivity(tier: TierLevel, currentCount: number): boolean {
  return currentCount < TIER_LIMITS[tier].activities
}

export function canUseCalendar(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].calendar
}

export function canUseNotifications(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].notifications
}

/** Whether the plan gets the daily UV push (Pro gets the morning plan in its place). */
export function canUseDailyUvPush(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].dailyUvPush
}

/** Whether the plan's reapply timer can also remind by push, with Solara closed. */
export function canUseReapplyPush(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].reapplyPush
}

export function canUseFamilyProfiles(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].profiles > 1
}

export function getFutureDays(tier: TierLevel): number {
  return TIER_LIMITS[tier].futureDays
}

export function getSavedLocationLimit(tier: TierLevel): number {
  return TIER_LIMITS[tier].savedLocations
}

export function getProfileLimit(tier: TierLevel): number {
  return TIER_LIMITS[tier].profiles
}

/** Whether the plan is kept only in this browser (a guest's). */
export function isDeviceOnly(tier: TierLevel): boolean {
  return TIER_LIMITS[tier].storage === 'device'
}

/** The forecast a plan sees, in words: "Today", "Today and tomorrow", "10 days". */
export function forecastLabel(tier: TierLevel): string {
  const days = getFutureDays(tier)
  if (days === 1) return m.forecastToday
  if (days === 2) return m.forecastTodayTomorrow
  return m.forecastDays(days)
}

/**
 * The activity-limit note for a plan that is full, pointing at the next plan up. With
 * `offerPro: false` (an app store build, which sells nothing) it names no Pro upgrade.
 */
export function activityLimitNote(
  tier: TierLevel,
  { offerPro = true }: { offerPro?: boolean } = {},
): string | null {
  if (tier === 'anonymous') {
    return m.limitGuest(TIER_LIMITS.anonymous.activities, TIER_LIMITS.free.activities)
  }
  if (tier === 'free') {
    const note = m.limitFree(TIER_LIMITS.free.activities)
    return offerPro ? m.limitFreeUpgrade(note, TIER_LIMITS.paid.activities) : note
  }
  return null
}

// With SPF 30+, effective safe UV is ~2.5x higher.
// This is still an estimate; UI copy should not imply medical precision.
export function effectiveMaxUV(activity: Activity): number {
  return sharedEffectiveMaxUV(activity)
}

// The preset activities, apart so code that only needs their ids or the plan limits does
// not carry the catalog (./presets.ts, ./preset-names.ts; ROADMAP item 52).
export { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES, type PresetCategory } from './presets'
