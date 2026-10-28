// Words for an activity's shade and surface setting (@solara/core exposure.ts), for the
// Edit activity form and the activity card.
import { exposureFactor, type ExposureSetting, type ShadeLevel, type Surface } from '@solara/core'

export const SHADE_OPTIONS: readonly { value: ShadeLevel | null; label: string }[] = [
  { value: null, label: 'Open sun' },
  { value: 'partial', label: 'Some shade' },
  { value: 'full', label: 'Mostly shade' },
]

export const SURFACE_OPTIONS: readonly { value: Surface | null; label: string }[] = [
  { value: null, label: 'Not set' },
  { value: 'grass', label: 'Grass' },
  { value: 'pavement', label: 'Pavement' },
  { value: 'water', label: 'Water' },
  { value: 'sand', label: 'Sand' },
  { value: 'snow', label: 'Snow' },
]

const SHADE_WORDS: Record<ShadeLevel, string> = { partial: 'some shade', full: 'mostly shade' }

/** The share of forecast UV an activity is planned for, as a whole percentage ("115%"). */
export function exposurePercent(setting: ExposureSetting): string {
  return `${Math.round(exposureFactor(setting) * 100)}%`
}

/**
 * "Sand, some shade · 90% of forecast UV", or null for an activity with no
 * shade or surface setting (planned for the forecast UV as is).
 */
export function exposureSummary(setting: ExposureSetting): string | null {
  const { shade, surface } = setting
  if (!shade && !surface) return null
  const surfaceLabel = surface && SURFACE_OPTIONS.find(o => o.value === surface)?.label
  const parts = [surfaceLabel, shade && SHADE_WORDS[shade]].filter(Boolean)
  const where = parts.join(', ')
  return `${where.charAt(0).toUpperCase()}${where.slice(1)} · ${exposurePercent(setting)} of forecast UV`
}
