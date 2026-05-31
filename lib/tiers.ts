import { TierLevel, Activity } from './types'

export const TIER_LIMITS: Record<TierLevel, { activities: number; calendar: boolean; notifications: boolean; futureDays: number; savedLocations: number }> = {
  anonymous: { activities: 1,   calendar: false, notifications: false, futureDays: 1,  savedLocations: 1  },
  free:      { activities: 3,   calendar: true,  notifications: false, futureDays: 2,  savedLocations: 3  },
  paid:      { activities: 999, calendar: true,  notifications: true,  futureDays: 10, savedLocations: 12 },
}

export const TIER_LABELS: Record<TierLevel, string> = {
  anonymous: 'Guest',
  free:      'Free',
  paid:      'Pro',
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

export function getFutureDays(tier: TierLevel): number {
  return TIER_LIMITS[tier].futureDays
}

export function getSavedLocationLimit(tier: TierLevel): number {
  return TIER_LIMITS[tier].savedLocations
}

// With SPF 30+, effective safe UV is ~2.5x higher.
// This is still an estimate; UI copy should not imply medical precision.
export function effectiveMaxUV(activity: Activity): number {
  if (activity.sunscreen) return Math.min(Math.round(activity.maxUV * 2.5), 11)
  return activity.maxUV
}

export interface PresetCategory {
  name:       string
  emoji:      string
  activities: Omit<Activity, 'sunscreen' | 'custom'>[]
}

export const ACTIVITY_CATEGORIES: PresetCategory[] = [
  {
    name: 'Running & cycling', emoji: '🏃',
    activities: [
      { id: 'run',     name: 'Running',         icon: '🏃', durationMins: 45,  maxUV: 4 },
      { id: 'jog',     name: 'Jogging',          icon: '🏃', durationMins: 30,  maxUV: 5 },
      { id: 'cycle',   name: 'Cycling',          icon: '🚴', durationMins: 60,  maxUV: 4 },
      { id: 'mtb',     name: 'Mountain biking',  icon: '🚵', durationMins: 90,  maxUV: 3 },
      { id: 'sprint',  name: 'Sprint workout',   icon: '💨', durationMins: 20,  maxUV: 6 },
    ],
  },
  {
    name: 'Water sports', emoji: '🏊',
    activities: [
      { id: 'swim',    name: 'Swimming',         icon: '🏊', durationMins: 60,  maxUV: 3 },
      { id: 'surf',    name: 'Surfing',           icon: '🏄', durationMins: 90,  maxUV: 3 },
      { id: 'kayak',   name: 'Kayaking',          icon: '🚣', durationMins: 60,  maxUV: 3 },
      { id: 'paddle',  name: 'Paddleboarding',   icon: '🛶', durationMins: 60,  maxUV: 3 },
    ],
  },
  {
    name: 'Outdoor leisure', emoji: '🧺',
    activities: [
      { id: 'walk',    name: 'Walking',           icon: '🚶', durationMins: 30,  maxUV: 5 },
      { id: 'hike',    name: 'Hiking',            icon: '🥾', durationMins: 120, maxUV: 3 },
      { id: 'picnic',  name: 'Picnic',            icon: '🧺', durationMins: 90,  maxUV: 4 },
      { id: 'garden',  name: 'Gardening',         icon: '🌱', durationMins: 60,  maxUV: 3 },
      { id: 'photo',   name: 'Photography',       icon: '📸', durationMins: 90,  maxUV: 4 },
      { id: 'read',    name: 'Reading outside',   icon: '📖', durationMins: 60,  maxUV: 5 },
    ],
  },
  {
    name: 'Sports & courts', emoji: '🎾',
    activities: [
      { id: 'golf',    name: 'Golf',              icon: '⛳', durationMins: 240, maxUV: 2 },
      { id: 'tennis',  name: 'Tennis',            icon: '🎾', durationMins: 60,  maxUV: 4 },
      { id: 'soccer',  name: 'Soccer',            icon: '⚽', durationMins: 90,  maxUV: 3 },
      { id: 'baseball',name: 'Baseball',          icon: '⚾', durationMins: 120, maxUV: 3 },
      { id: 'yoga',    name: 'Outdoor yoga',      icon: '🧘', durationMins: 45,  maxUV: 4 },
      { id: 'bball',   name: 'Basketball',        icon: '🏀', durationMins: 60,  maxUV: 4 },
    ],
  },
  {
    name: 'Quick breaks', emoji: '☀️',
    activities: [
      { id: 'break',   name: 'Sun break',         icon: '☀️', durationMins: 5,   maxUV: 8 },
      { id: 'lunch',   name: 'Lunch outside',     icon: '🥗', durationMins: 30,  maxUV: 5 },
      { id: 'coffee',  name: 'Morning coffee',    icon: '☕', durationMins: 15,  maxUV: 6 },
      { id: 'dog',     name: 'Dog walk',          icon: '🐕', durationMins: 30,  maxUV: 5 },
    ],
  },
]

// Flat list for preference migrations and backwards compatibility.
export const PRESET_ACTIVITIES = ACTIVITY_CATEGORIES.flatMap(c =>
  c.activities.map(a => ({ ...a, sunscreen: false as const }))
)
