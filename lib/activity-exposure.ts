// Words for an activity's shade and surface setting (@solara/core exposure.ts), for the
// Edit activity form and the activity card.
import { exposureFactor, type ExposureSetting, type ShadeLevel, type Surface } from '@solara/core'
import { formatNumber } from '@solara/core/i18n'
import m from '@/messages/activities'

// Labels are read when shown, in the page's language.
function option<T>(value: T, label: () => string): { value: T; readonly label: string } {
  return {
    value,
    get label() {
      return label()
    },
  }
}

export const SHADE_OPTIONS: readonly { value: ShadeLevel | null; readonly label: string }[] = [
  option(null, () => m.openSun),
  option('partial', () => m.someShade),
  option('full', () => m.mostlyShade),
]

export const SURFACE_OPTIONS: readonly { value: Surface | null; readonly label: string }[] = [
  option(null, () => m.surfaceNotSet),
  option('grass', () => m.grass),
  option('pavement', () => m.pavement),
  option('water', () => m.water),
  option('sand', () => m.sand),
  option('snow', () => m.snow),
]

const SHADE_WORDS: Record<ShadeLevel, () => string> = {
  partial: () => m.someShadeLower,
  full: () => m.mostlyShadeLower,
}

/** The share of forecast UV an activity is planned for, as a whole percentage ("115%"). */
export function exposurePercent(setting: ExposureSetting): string {
  return `${formatNumber(Math.round(exposureFactor(setting) * 100))}%`
}

/**
 * "Sand, some shade · 90% of forecast UV", or null for an activity with no
 * shade or surface setting (planned for the forecast UV as is).
 */
export function exposureSummary(setting: ExposureSetting): string | null {
  const { shade, surface } = setting
  if (!shade && !surface) return null
  const surfaceLabel = surface && SURFACE_OPTIONS.find(o => o.value === surface)?.label
  const parts = [surfaceLabel, shade && SHADE_WORDS[shade]()].filter(Boolean)
  const where = parts.join(', ')
  return m.exposureSummary(
    `${where.charAt(0).toUpperCase()}${where.slice(1)}`,
    exposurePercent(setting),
  )
}
