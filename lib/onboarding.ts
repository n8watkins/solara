// Setup flow data and the live UV preview (components/Onboarding.tsx).
import { OPEN_METEO_FORECAST_URL, SKIN_BURN_BASE, SKIN_TYPES, fetchJson } from '@solara/core'
import { SKIN_TYPE_LABELS } from './profiles'
import type { Location, SkinType } from './types'

export type OnboardingStep = 'location' | 'uvpreview' | 'skin' | 'finish'

/** The 1-3 progress bar position of each step (the UV preview belongs to step 1). */
export const ONBOARDING_PROGRESS: Readonly<Record<OnboardingStep, 1 | 2 | 3>> = {
  location: 1,
  uvpreview: 1,
  skin: 2,
  finish: 3,
}

/** The step "Back" returns to, or null on the first step. */
export const ONBOARDING_BACK: Readonly<Record<OnboardingStep, OnboardingStep | null>> = {
  location: null,
  uvpreview: 'location',
  skin: 'location',
  finish: 'skin',
}

/**
 * What to tell someone whose "Use my location" failed, by the browser's
 * GeolocationPositionError code (null: the browser has no geolocation at all).
 */
export function geolocationErrorMessage(code: number | null): string {
  switch (code) {
    case null:
      return "This browser can't share your location. Type a city instead."
    case 1:
      return 'Location access is turned off for this site. Allow it in your browser, or type a city.'
    case 3:
      return 'Finding your location took too long. Try again, or type a city.'
    default:
      return "Your location couldn't be found. Try again, or type a city."
  }
}

const SKIN_DESCRIPTIONS: Readonly<Record<SkinType, string>> = {
  'very-fair': 'Burns easily, rarely tans',
  fair: 'Burns often, tans lightly',
  medium: 'Burns sometimes, tans well',
  olive: 'Rarely burns, tans easily',
  dark: 'Very rarely burns',
}

export interface SkinOption {
  value: SkinType
  label: string
  desc: string
  /** Rough minutes to a burn at UV 10, from the recommendation engine's table. */
  burnTime: string
}

/** The skin type choices, lightest first. */
export const SKIN_OPTIONS: readonly SkinOption[] = SKIN_TYPES.map(value => ({
  value,
  label: SKIN_TYPE_LABELS[value],
  desc: SKIN_DESCRIPTIONS[value],
  burnTime: `~${SKIN_BURN_BASE[value]}m`,
}))

/**
 * The UV index right now at `location`, rounded to one decimal. Rejects when
 * Open-Meteo fails or answers without a usable value.
 */
export async function fetchCurrentUV(
  location: Pick<Location, 'lat' | 'lon'>,
  fetchImpl?: typeof fetch,
): Promise<number> {
  const url = `${OPEN_METEO_FORECAST_URL}?latitude=${location.lat}&longitude=${location.lon}&current=uv_index&timezone=auto`
  const data = (await fetchJson(url, { fetchImpl })) as { current?: { uv_index?: unknown } }
  const uv = data?.current?.uv_index
  if (typeof uv !== 'number' || !Number.isFinite(uv) || uv < 0) {
    throw new Error('Open-Meteo returned no current UV index')
  }
  return Math.round(uv * 10) / 10
}
