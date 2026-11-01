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
  /** Places kept for quick switching, the active one included. */
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
    savedLocations: 1,
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
    savedLocations: 3,
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

export interface PresetCategory {
  /** The category's stable name, kept with collapsed categories (English). */
  name: string
  /** The name shown, in the page's language. */
  readonly label: string
  emoji: string
  activities: Omit<Activity, 'sunscreen' | 'custom'>[]
}

type Preset = PresetCategory['activities'][number]

/** A preset activity whose name reads in the page's language (plans messages). */
function preset(id: keyof typeof m, fields: Omit<Preset, 'id' | 'name'>): Preset {
  return Object.defineProperty({ id, ...fields }, 'name', {
    get: () => m[id],
    enumerable: true,
  }) as Preset
}

export const ACTIVITY_CATEGORIES: PresetCategory[] = [
  {
    name: 'Running & cycling',
    get label() {
      return m.categoryRunning
    },
    emoji: '🏃',
    activities: [
      preset('run', { icon: '🏃', durationMins: 45, maxUV: 4 }),
      preset('jog', { icon: '🏃', durationMins: 30, maxUV: 5 }),
      preset('cycle', { icon: '🚴', durationMins: 60, maxUV: 4 }),
      preset('mtb', { icon: '🚵', durationMins: 90, maxUV: 3 }),
      preset('sprint', { icon: '💨', durationMins: 20, maxUV: 6 }),
    ],
  },
  {
    name: 'Water sports',
    get label() {
      return m.categoryWater
    },
    emoji: '🏊',
    activities: [
      preset('swim', { icon: '🏊', durationMins: 60, maxUV: 3 }),
      preset('surf', { icon: '🏄', durationMins: 90, maxUV: 3 }),
      preset('kayak', { icon: '🚣', durationMins: 60, maxUV: 3 }),
      preset('paddle', { icon: '🛶', durationMins: 60, maxUV: 3 }),
    ],
  },
  {
    name: 'Outdoor leisure',
    get label() {
      return m.categoryLeisure
    },
    emoji: '🧺',
    activities: [
      preset('walk', { icon: '🚶', durationMins: 30, maxUV: 5 }),
      preset('hike', { icon: '🥾', durationMins: 120, maxUV: 3 }),
      preset('picnic', { icon: '🧺', durationMins: 90, maxUV: 4 }),
      preset('garden', { icon: '🌱', durationMins: 60, maxUV: 3 }),
      preset('photo', { icon: '📸', durationMins: 90, maxUV: 4 }),
      preset('read', { icon: '📖', durationMins: 60, maxUV: 5 }),
    ],
  },
  {
    name: 'Sports & courts',
    get label() {
      return m.categorySports
    },
    emoji: '🎾',
    activities: [
      preset('golf', { icon: '⛳', durationMins: 240, maxUV: 2 }),
      preset('tennis', { icon: '🎾', durationMins: 60, maxUV: 4 }),
      preset('soccer', { icon: '⚽', durationMins: 90, maxUV: 3 }),
      preset('baseball', { icon: '⚾', durationMins: 120, maxUV: 3 }),
      preset('yoga', { icon: '🧘', durationMins: 45, maxUV: 4 }),
      preset('bball', { icon: '🏀', durationMins: 60, maxUV: 4 }),
    ],
  },
  {
    name: 'Quick breaks',
    get label() {
      return m.categoryBreaks
    },
    emoji: '☀️',
    activities: [
      preset('break', { icon: '☀️', durationMins: 5, maxUV: 8 }),
      preset('lunch', { icon: '🥗', durationMins: 30, maxUV: 5 }),
      preset('coffee', { icon: '☕', durationMins: 15, maxUV: 6 }),
      preset('dog', { icon: '🐕', durationMins: 30, maxUV: 5 }),
    ],
  },
]

// Flat list for preference migrations and backwards compatibility.
// Each keeps its name's getter, so the name reads in the page's language when used.
export const PRESET_ACTIVITIES = ACTIVITY_CATEGORIES.flatMap(c =>
  c.activities.map(a =>
    Object.defineProperty({ ...a, sunscreen: false as const }, 'name', {
      get: () => a.name,
      enumerable: true,
    }),
  ),
)
