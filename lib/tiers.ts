import { TierLevel } from './types'

export const TIER_LIMITS: Record<TierLevel, { activities: number; calendar: boolean; notifications: boolean }> = {
  anonymous: { activities: 0,   calendar: false, notifications: false },
  free:      { activities: 1,   calendar: true,  notifications: false },
  paid:      { activities: 999, calendar: true,  notifications: true  },
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

export const PRESET_ACTIVITIES = [
  { id: 'run',     name: 'Running',        icon: '🏃', durationMins: 45,  maxUV: 4 },
  { id: 'walk',    name: 'Walking',        icon: '🚶', durationMins: 30,  maxUV: 5 },
  { id: 'swim',    name: 'Swimming',       icon: '🏊', durationMins: 60,  maxUV: 3 },
  { id: 'hike',    name: 'Hiking',         icon: '🥾', durationMins: 120, maxUV: 3 },
  { id: 'golf',    name: 'Golf',           icon: '⛳', durationMins: 240, maxUV: 2 },
  { id: 'cycle',   name: 'Cycling',        icon: '🚴', durationMins: 60,  maxUV: 4 },
  { id: 'tennis',  name: 'Tennis',         icon: '🎾', durationMins: 60,  maxUV: 4 },
  { id: 'garden',  name: 'Gardening',      icon: '🌱', durationMins: 60,  maxUV: 3 },
  { id: 'yoga',    name: 'Outdoor yoga',   icon: '🧘', durationMins: 45,  maxUV: 4 },
  { id: 'break',   name: 'Quick sun break',icon: '☀️', durationMins: 5,   maxUV: 8 },
  { id: 'picnic',  name: 'Picnic',         icon: '🧺', durationMins: 90,  maxUV: 3 },
  { id: 'read',    name: 'Reading outside',icon: '📖', durationMins: 60,  maxUV: 5 },
]
