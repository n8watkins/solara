import { NewerPreferencesVersionError, parsePreferences, PREFS_SCHEMA_VERSION } from '@solara/core'
import type { UserPreferences, Location } from './types'
import { PRESET_ACTIVITIES, ACTIVITY_CATEGORIES } from '@solara/core/tiers'
import { PREFS_KEY, saveLocalPrefs } from './local-prefs'

// The document schema, its versions and migrations live in @solara/core
// (packages/core/src/prefs.ts). This module adds what depends on the app's activity
// catalog and keeps the browser copy; the Firestore account document is read and written
// by lib/account-prefs.ts, which loads only for an account, so a guest's first load never
// carries it. This module runs the Valibot schema, so a guest's first load never carries it
// either: writing the browser copy is lib/local-prefs.ts, and a guest's own plan is read
// by lib/guest.ts (ROADMAP item 52).

export { NewerPreferencesVersionError, PREFS_SCHEMA_VERSION }

const PRESETS = new Map(PRESET_ACTIVITIES.map(preset => [preset.id, preset]))
const CATEGORY_NAMES = new Set(ACTIVITY_CATEGORIES.map(category => category.name))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A preset activity with missing fields takes them from the catalog. */
function withPresetDefaults(raw: unknown): unknown {
  if (!isRecord(raw) || typeof raw.id !== 'string') return raw
  const preset = PRESETS.get(raw.id)
  if (!preset) return raw
  return {
    ...raw,
    name: typeof raw.name === 'string' && !raw.name.trim() ? preset.name : raw.name,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon : preset.icon,
    durationMins: typeof raw.durationMins === 'number' ? raw.durationMins : preset.durationMins,
    maxUV: typeof raw.maxUV === 'number' ? raw.maxUV : preset.maxUV,
  }
}

/**
 * Migrates and normalizes stored preferences (see `parsePreferences` in @solara/core),
 * filling preset activities from the catalog and keeping only suggestion ids and
 * category names the app knows. Returns null without a valid location or fallback.
 */
export function normalizePrefs(raw: unknown, fallbackLocation?: Location): UserPreferences | null {
  const input =
    isRecord(raw) && Array.isArray(raw.activities)
      ? { ...raw, activities: raw.activities.map(withPresetDefaults) }
      : raw
  const prefs = parsePreferences(input, { fallbackLocation })
  if (!prefs) return null
  prefs.hiddenActivitySuggestionIds = prefs.hiddenActivitySuggestionIds.filter(id =>
    PRESETS.has(id),
  )
  prefs.collapsedActivityCategories = prefs.collapsedActivityCategories.filter(name =>
    CATEGORY_NAMES.has(name),
  )
  return prefs
}

export function loadLocalPrefs(): UserPreferences | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const normalized = normalizePrefs(parsed)
    if (normalized && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      saveLocalPrefs(normalized)
    }
    return normalized
  } catch {
    try {
      localStorage.removeItem(PREFS_KEY)
    } catch {}
    return null
  }
}
