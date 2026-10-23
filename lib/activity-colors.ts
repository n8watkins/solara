import type { Activity } from './types'

// One color per activity, by its position in the account's list, shared by the
// calendar's lanes and every scheduled-activity surface.
// 700-level hues: white text on each meets WCAG AA (4.5:1) in both themes.
export const ACTIVITY_COLORS = [
  '#C2410C',
  '#1D4ED8',
  '#047857',
  '#6D28D9',
  '#B45309',
  '#BE185D',
  '#0E7490',
  '#4D7C0F',
] as const

/** The color for `activityId` among `activities` (the first color when it is not listed). */
export function activityColor(
  activities: readonly Pick<Activity, 'id'>[],
  activityId: string,
): string {
  const idx = activities.findIndex(a => a.id === activityId)
  return ACTIVITY_COLORS[Math.max(0, idx) % ACTIVITY_COLORS.length] ?? ACTIVITY_COLORS[0]
}
