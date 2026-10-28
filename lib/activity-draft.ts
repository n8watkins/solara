import type { Activity } from './types'

/**
 * The fields of an activity the editor can change, in the normalized form a
 * saved draft takes: the 'earliest' time preference, no cloud adjustment and
 * "every day" are all stored as absent. Comparing this form, instead of the
 * raw objects, keeps an untouched activity from looking edited.
 */
export function editableActivityFields(a: Activity) {
  const days = a.daysOfWeek
  return {
    name: a.name,
    icon: a.icon,
    durationMins: a.durationMins,
    sunscreen: a.sunscreen,
    maxUV: a.maxUV,
    preferredHours: a.preferredHours ?? null,
    timePreference: a.timePreference ?? 'earliest',
    daysOfWeek:
      !days || days.length === 0 || days.length === 7 ? null : [...days].sort((x, y) => x - y),
    cloudSensitive: !!a.cloudSensitive,
    shade: a.shade ?? null,
    surface: a.surface ?? null,
  }
}

/** Whether `draft` differs from `saved` in any field the editor can change. */
export function activityEdited(saved: Activity, draft: Activity): boolean {
  return (
    JSON.stringify(editableActivityFields(saved)) !== JSON.stringify(editableActivityFields(draft))
  )
}
