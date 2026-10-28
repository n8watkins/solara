// Pure logic behind the Settings dialog (components/PreferencesModal.tsx): the
// draft it edits, whether that draft has unsaved changes, and the plan limits
// it lists on the Account tab.
import { QUIET_HOURS, UV_ALERT_THRESHOLD } from '@solara/core'
import { TIER_LIMITS } from './tiers'
import type { Location, SkinType, TierLevel, UserPreferences } from './types'

/** The preferences the Settings dialog edits, with every default filled in. */
export interface SettingsDraft {
  skinType: SkinType
  location: Location
  showSunPath: boolean
  hiddenActivitySuggestionIds: string[]
  collapsedActivityCategories: string[]
  notificationHour: number
  /** The UV alert's threshold; UV_ALERT_THRESHOLD.off (0) is off. */
  uvAlertThreshold: number
  /** When alerts other than the morning one wait. */
  quietHours: { from: number; to: number }
  /** Pro heads-ups before high-UV events (on unless turned off). */
  eventHeadsUp: boolean
  /** 'auto' follows the browser locale. */
  temperatureUnit: NonNullable<UserPreferences['temperatureUnit']>
  /** 'auto' follows the browser locale. */
  clockFormat: NonNullable<UserPreferences['clockFormat']>
}

const DRAFT_FIELDS = [
  'skinType',
  'location',
  'showSunPath',
  'hiddenActivitySuggestionIds',
  'collapsedActivityCategories',
  'notificationHour',
  'uvAlertThreshold',
  'quietHours',
  'eventHeadsUp',
  'temperatureUnit',
  'clockFormat',
] as const satisfies readonly (keyof SettingsDraft)[]

/** Morning notifications go out at 7:00 local time unless the person picks another hour. */
export const DEFAULT_NOTIFICATION_HOUR = 7

/** The draft a freshly opened Settings dialog starts from. */
export function settingsDraftFrom(prefs: UserPreferences): SettingsDraft {
  return {
    skinType: prefs.skinType,
    location: prefs.location,
    showSunPath: prefs.showSunPath !== false,
    hiddenActivitySuggestionIds: prefs.hiddenActivitySuggestionIds ?? [],
    collapsedActivityCategories: prefs.collapsedActivityCategories ?? [],
    notificationHour: prefs.notificationHour ?? DEFAULT_NOTIFICATION_HOUR,
    uvAlertThreshold: prefs.uvAlertThreshold ?? UV_ALERT_THRESHOLD.off,
    quietHours: prefs.quietHours ?? { ...QUIET_HOURS.default },
    eventHeadsUp: prefs.eventHeadsUp !== false,
    temperatureUnit: prefs.temperatureUnit ?? 'auto',
    clockFormat: prefs.clockFormat ?? 'auto',
  }
}

/**
 * True when the draft differs from the saved preferences. A field set back to
 * its saved value (or to the default the saved value stands for) is not a change.
 */
export function isSettingsDraftDirty(prefs: UserPreferences, draft: SettingsDraft): boolean {
  const saved = settingsDraftFrom(prefs)
  return DRAFT_FIELDS.some(field => JSON.stringify(saved[field]) !== JSON.stringify(draft[field]))
}

/** The preferences to save: everything the dialog does not edit stays as it was. */
export function applySettingsDraft(prefs: UserPreferences, draft: SettingsDraft): UserPreferences {
  return { ...prefs, ...draft }
}

/** One row of the plan summary: a count or note, or whether the feature is included. */
export interface PlanLimitRow {
  label: string
  value: string | boolean
}

export function planLimitRows(tier: TierLevel, activityCount: number): PlanLimitRow[] {
  return [
    {
      label: 'Activities',
      value: `${activityCount} / ${TIER_LIMITS[tier].activities}`,
    },
    { label: 'Calendar sync', value: TIER_LIMITS[tier].calendar },
    { label: '10-day forecast', value: tier === 'paid' },
  ]
}
