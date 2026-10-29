import type { Activity } from './types'
import { ACTIVITY_CATEGORIES, type PresetCategory } from '@solara/core/tiers'

/** A preset suggestion: an activity without the fields a person sets. */
export type Preset = PresetCategory['activities'][number]

/** The shortest duration an activity can have, in minutes. */
export const MIN_DURATION_MINS = 5

/** A compact duration label: "45m" under an hour, "1.5h" from an hour up. */
export function formatActivityDuration(mins: number): string {
  return mins < 60 ? `${mins}m` : `${mins / 60}h`
}

/** A duration in whole minutes, never below MIN_DURATION_MINS. */
export function clampDuration(mins: number): number {
  return Number.isFinite(mins) ? Math.max(MIN_DURATION_MINS, Math.round(mins)) : MIN_DURATION_MINS
}

/** The categories to show in the preset browser for a search and the hidden presets. */
export function presetCategoriesFor(
  search: string,
  hiddenIds: readonly string[],
  categories: readonly PresetCategory[] = ACTIVITY_CATEGORIES,
): PresetCategory[] {
  const hidden = new Set(hiddenIds)
  const query = search.trim().toLowerCase()
  if (query) {
    return [
      {
        name: 'Results',
        emoji: '🔍',
        activities: categories
          .flatMap(c => c.activities)
          .filter(a => !hidden.has(a.id) && a.name.toLowerCase().includes(query)),
      },
    ]
  }
  return categories
    .map(cat => ({ ...cat, activities: cat.activities.filter(a => !hidden.has(a.id)) }))
    .filter(cat => cat.activities.length > 0)
}

/** The hidden presets, in catalog order, each with the name of its category. */
export function hiddenPresetsFor(
  hiddenIds: readonly string[],
  categories: readonly PresetCategory[] = ACTIVITY_CATEGORIES,
): (Preset & { category: string })[] {
  const hidden = new Set(hiddenIds)
  return categories.flatMap(cat =>
    cat.activities.filter(a => hidden.has(a.id)).map(a => ({ ...a, category: cat.name })),
  )
}

/** `list` with `item` removed if present, or appended if not. */
export function toggleInList<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter(x => x !== item) : [...list, item]
}

/** A preset as a saved activity, without sunscreen until the person says otherwise. */
export function activityFromPreset(preset: Preset): Activity {
  return { ...preset, sunscreen: false }
}

export interface CustomActivityInput {
  name: string
  icon: string
  durationMins: number
  sunscreen: boolean
}

/** A new custom activity. `now` (milliseconds) makes the id unique. */
export function customActivity(input: CustomActivityInput, now: number): Activity {
  return {
    id: `custom_${now}`,
    name: input.name.trim(),
    icon: input.icon,
    durationMins: clampDuration(input.durationMins),
    maxUV: 4,
    sunscreen: input.sunscreen,
    custom: true,
  }
}

/** A custom copy of `activity` named "<name> copy". */
export function duplicateActivity(activity: Activity, now: number): Activity {
  return { ...activity, id: `custom_${now}`, name: `${activity.name} copy`, custom: true }
}

/** `activities` with the one whose id is `id` changed by `patch`. */
export function updateActivity(
  activities: readonly Activity[],
  id: string,
  patch: Partial<Omit<Activity, 'id'>>,
): Activity[] {
  return activities.map(a => (a.id === id ? { ...a, ...patch } : a))
}

/** `activities` without the one whose id is `id`. */
export function removeActivity(activities: readonly Activity[], id: string): Activity[] {
  return activities.filter(a => a.id !== id)
}
