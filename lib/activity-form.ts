import type { ShadeLevel, Surface } from '@solara/core'
import { weatherDefaults, weatherLimits } from '@solara/core/weather-fit'
import type { Activity, TimePreference } from './types'
import { clampDuration } from './activity-presets'
import m from '@/messages/editor'

/** The edit form's fields, as typed, before they are normalized into an activity. */
export interface ActivityForm {
  name: string
  icon: string
  durationMins: number
  sunscreen: boolean
  maxUV: number
  preferredEnabled: boolean
  preferredFrom: number
  preferredTo: number
  timePreference: TimePreference
  days: number[]
  cloudSensitive: boolean
  /** null: open sun. */
  shade: ShadeLevel | null
  /** null: not set. */
  surface: Surface | null
  /** Skip hours with likely rain (the activity's setting, else its default). */
  avoidRain: boolean
  /** Feels-like limit in Celsius, or null for none (the setting, else the default). */
  maxFeelsLikeC: number | null
}

/** The form for editing `activity`, with defaults for the fields it leaves out. */
export function activityForm(activity: Activity): ActivityForm {
  return {
    name: activity.name,
    icon: activity.icon,
    durationMins: activity.durationMins,
    sunscreen: activity.sunscreen,
    maxUV: activity.maxUV,
    preferredEnabled: !!activity.preferredHours,
    preferredFrom: activity.preferredHours?.from ?? 6,
    preferredTo: activity.preferredHours?.to ?? 20,
    timePreference: activity.timePreference ?? 'earliest',
    days: activity.daysOfWeek ?? [],
    cloudSensitive: activity.cloudSensitive ?? false,
    shade: activity.shade ?? null,
    surface: activity.surface ?? null,
    ...weatherLimits(activity),
  }
}

/** A planning UV limit between 0 and 11, to one decimal place. */
export function clampUV(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(11, Math.round(value * 10) / 10))
}

/** Preferred hours as a valid range: `from` in 0-23 and `to` after it, up to 24. */
export function normalizedHours(from: number, to: number): { from: number; to: number } {
  const start = Math.max(0, Math.min(23, Math.round(from)))
  return { from: start, to: Math.max(start + 1, Math.min(24, Math.round(to))) }
}

/** Selected weekdays, sorted, or undefined when none or all seven mean "every day". */
export function normalizedDays(days: readonly number[]): number[] | undefined {
  return days.length === 0 || days.length === 7 ? undefined : [...days].sort((a, b) => a - b)
}

/**
 * `activity` with the form applied. Defaults are stored as absent ('earliest'
 * time, no cloud adjustment, every day, open sun, no surface, the activity's own rain
 * and heat defaults), matching the preferences normalizer.
 */
export function activityFromForm(activity: Activity, form: ActivityForm): Activity {
  const weather = weatherDefaults(activity.id)
  return {
    ...activity,
    name: form.name.trim() || activity.name,
    icon: form.icon,
    durationMins: clampDuration(form.durationMins),
    sunscreen: form.sunscreen,
    maxUV: clampUV(form.maxUV),
    preferredHours: form.preferredEnabled
      ? normalizedHours(form.preferredFrom, form.preferredTo)
      : undefined,
    timePreference: form.timePreference === 'earliest' ? undefined : form.timePreference,
    daysOfWeek: normalizedDays(form.days),
    cloudSensitive: form.cloudSensitive || undefined,
    shade: form.shade ?? undefined,
    surface: form.surface ?? undefined,
    avoidRain: form.avoidRain === weather.avoidRain ? undefined : form.avoidRain,
    maxFeelsLikeC: form.maxFeelsLikeC === weather.maxFeelsLikeC ? undefined : form.maxFeelsLikeC,
  }
}

/** "Every day", or how many days are picked ("1 day", "5 days"). */
export function daysSummary(days: readonly number[]): string {
  if (!normalizedDays(days)) return m.everyDay
  return m.dayCount(days.length)
}

/** The weekdays' names, Sunday first, in the page's language. */
export function dayNames(): string[] {
  return m.dayNames.split(',')
}

/** Each weekday's one-letter button label, Sunday first ("S", "M", ...). */
export function dayInitials(): string[] {
  return m.dayInitials.split(',')
}

/** One-tap day selections; an empty set means every day. */
export function dayPresets(): { label: string; days: readonly number[] }[] {
  return [
    { label: m.everyDay, days: [] },
    { label: m.weekdays, days: [1, 2, 3, 4, 5] },
    { label: m.weekends, days: [0, 6] },
  ]
}
