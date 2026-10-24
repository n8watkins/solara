import type { TierLevel, Activity } from './types'
import { effectiveMaxUV as sharedEffectiveMaxUV } from './recommendation'

/** What each plan includes. Every tier rule in the app reads from here. */
export interface TierLimits {
  /** Activities the plan can hold. */
  activities: number
  /** Google Calendar booking, scheduled activities, the live feed and the .ics export. */
  calendar: boolean
  /** Morning sun alerts (Pro, relaunching with billing). */
  notifications: boolean
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
 * The three plans (owner decision D7, 2026-10-23; calendar on Free is pending):
 *
 * |                     | Guest (no sign-in) | Free account       | Pro     |
 * | ------------------- | ------------------ | ------------------ | ------- |
 * | Forecast            | Today              | Today and tomorrow | 10 days |
 * | Activities          | 1                  | 3                  | 20      |
 * | Storage             | This device only   | Synced             | Synced  |
 * | Calendar, alerts, family profiles | -    | -                  | Yes     |
 */
export const TIER_LIMITS: Record<TierLevel, TierLimits> = {
  anonymous: {
    activities: 1,
    calendar: false,
    notifications: false,
    futureDays: 1,
    savedLocations: 1,
    profiles: 1,
    storage: 'device',
  },
  free: {
    activities: 3,
    // The D7 table lists calendar under Pro, but whether Google Calendar booking
    // stays free is still the owner's decision, so Free keeps it until then.
    calendar: true,
    notifications: false,
    futureDays: 2,
    savedLocations: 3,
    profiles: 1,
    storage: 'synced',
  },
  paid: {
    activities: 20,
    calendar: true,
    notifications: true,
    futureDays: 10,
    savedLocations: 12,
    profiles: 6,
    storage: 'synced',
  },
}

/** Display names for the plans. */
export const TIER_NAMES: Record<TierLevel, string> = {
  anonymous: 'Guest',
  free: 'Free',
  paid: 'Pro',
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
  if (days === 1) return 'Today'
  if (days === 2) return 'Today and tomorrow'
  return `${days} days`
}

/** The activity-limit note for a plan that is full, pointing at the next plan up. */
export function activityLimitNote(tier: TierLevel): string | null {
  if (tier === 'anonymous') {
    return `Guests can plan ${TIER_LIMITS.anonymous.activities} activity. Sign in free to plan up to ${TIER_LIMITS.free.activities}.`
  }
  if (tier === 'free') {
    return `Free plan: up to ${TIER_LIMITS.free.activities} activities. Upgrade to Pro for up to ${TIER_LIMITS.paid.activities}.`
  }
  return null
}

// With SPF 30+, effective safe UV is ~2.5x higher.
// This is still an estimate; UI copy should not imply medical precision.
export function effectiveMaxUV(activity: Activity): number {
  return sharedEffectiveMaxUV(activity)
}

export interface PresetCategory {
  name: string
  emoji: string
  activities: Omit<Activity, 'sunscreen' | 'custom'>[]
}

export const ACTIVITY_CATEGORIES: PresetCategory[] = [
  {
    name: 'Running & cycling',
    emoji: '🏃',
    activities: [
      { id: 'run', name: 'Running', icon: '🏃', durationMins: 45, maxUV: 4 },
      { id: 'jog', name: 'Jogging', icon: '🏃', durationMins: 30, maxUV: 5 },
      { id: 'cycle', name: 'Cycling', icon: '🚴', durationMins: 60, maxUV: 4 },
      { id: 'mtb', name: 'Mountain biking', icon: '🚵', durationMins: 90, maxUV: 3 },
      { id: 'sprint', name: 'Sprint workout', icon: '💨', durationMins: 20, maxUV: 6 },
    ],
  },
  {
    name: 'Water sports',
    emoji: '🏊',
    activities: [
      { id: 'swim', name: 'Swimming', icon: '🏊', durationMins: 60, maxUV: 3 },
      { id: 'surf', name: 'Surfing', icon: '🏄', durationMins: 90, maxUV: 3 },
      { id: 'kayak', name: 'Kayaking', icon: '🚣', durationMins: 60, maxUV: 3 },
      { id: 'paddle', name: 'Paddleboarding', icon: '🛶', durationMins: 60, maxUV: 3 },
    ],
  },
  {
    name: 'Outdoor leisure',
    emoji: '🧺',
    activities: [
      { id: 'walk', name: 'Walking', icon: '🚶', durationMins: 30, maxUV: 5 },
      { id: 'hike', name: 'Hiking', icon: '🥾', durationMins: 120, maxUV: 3 },
      { id: 'picnic', name: 'Picnic', icon: '🧺', durationMins: 90, maxUV: 4 },
      { id: 'garden', name: 'Gardening', icon: '🌱', durationMins: 60, maxUV: 3 },
      { id: 'photo', name: 'Photography', icon: '📸', durationMins: 90, maxUV: 4 },
      { id: 'read', name: 'Reading outside', icon: '📖', durationMins: 60, maxUV: 5 },
    ],
  },
  {
    name: 'Sports & courts',
    emoji: '🎾',
    activities: [
      { id: 'golf', name: 'Golf', icon: '⛳', durationMins: 240, maxUV: 2 },
      { id: 'tennis', name: 'Tennis', icon: '🎾', durationMins: 60, maxUV: 4 },
      { id: 'soccer', name: 'Soccer', icon: '⚽', durationMins: 90, maxUV: 3 },
      { id: 'baseball', name: 'Baseball', icon: '⚾', durationMins: 120, maxUV: 3 },
      { id: 'yoga', name: 'Outdoor yoga', icon: '🧘', durationMins: 45, maxUV: 4 },
      { id: 'bball', name: 'Basketball', icon: '🏀', durationMins: 60, maxUV: 4 },
    ],
  },
  {
    name: 'Quick breaks',
    emoji: '☀️',
    activities: [
      { id: 'break', name: 'Sun break', icon: '☀️', durationMins: 5, maxUV: 8 },
      { id: 'lunch', name: 'Lunch outside', icon: '🥗', durationMins: 30, maxUV: 5 },
      { id: 'coffee', name: 'Morning coffee', icon: '☕', durationMins: 15, maxUV: 6 },
      { id: 'dog', name: 'Dog walk', icon: '🐕', durationMins: 30, maxUV: 5 },
    ],
  },
]

// Flat list for preference migrations and backwards compatibility.
export const PRESET_ACTIVITIES = ACTIVITY_CATEGORIES.flatMap(c =>
  c.activities.map(a => ({ ...a, sunscreen: false as const })),
)
