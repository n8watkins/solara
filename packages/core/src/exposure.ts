// Shade and surface reflection: how much of the forecast UV an activity's setting
// passes on to skin. The UV index is measured on open, level ground under the sky; a
// shaded spot gets less of the sky's UV, and a bright surface reflects some back up.
//
// Model (an estimate, kept cautious on purpose):
//   effective UV = forecast UV x (shade factor + surface reflectance)
// Shade cuts only the UV from the sky; reflection from a sunlit surface around the
// shade still reaches skin, so it is added rather than multiplied.
//
// Shade: shade "can reduce UV by 50% or more" (WHO, Global Solar UV Index: A Practical
// Guide, 2002), but skin in shade still receives scattered UV from the open sky. Solara
// takes the cautious end: full shade halves the sky's UV (0.5) and partial shade (some
// shade, part of the time) takes off a quarter (0.75).
//
// Surface reflectance of sunburning UV, the upper end of published values:
//   snow 0.85   fresh snow, 85% at 300 nm (Feister and Grewe, Photochem Photobiol
//               1995;62:736-744); "as much as 80%" (US EPA, A Guide to the UV Index, 2004)
//   sand 0.15   EPA 15%; dry bright sand 0.14 at 300 nm (Feister and Grewe)
//   water 0.10  EPA 10%
//   pavement 0.10  concrete 0.07-0.10 in UVB (Feister and Grewe)
//   grass 0.02  vegetation 0.016-0.017 in UVB (Feister and Grewe)
// An activity without a surface setting adds nothing, as before this setting existed.

/** How much of the time an activity is shaded. Undefined: open sun. */
export const SHADE_LEVELS = Object.freeze(['partial', 'full'] as const)
export type ShadeLevel = (typeof SHADE_LEVELS)[number]

/** The ground around an activity. Undefined: not set, no reflection added. */
export const SURFACES = Object.freeze(['grass', 'pavement', 'water', 'sand', 'snow'] as const)
export type Surface = (typeof SURFACES)[number]

/** The share of the sky's UV that reaches skin at each shade level. */
export const SHADE_FACTORS: Readonly<Record<ShadeLevel, number>> = Object.freeze({
  partial: 0.75,
  full: 0.5,
})

/** The share of UV each surface reflects back toward skin. */
export const SURFACE_REFLECTANCE: Readonly<Record<Surface, number>> = Object.freeze({
  grass: 0.02,
  pavement: 0.1,
  water: 0.1,
  sand: 0.15,
  snow: 0.85,
})

export interface ExposureSetting {
  shade?: ShadeLevel | null
  surface?: Surface | null
}

/** The factor applied to forecast UV for an activity's shade and surface (1 when neither is set). */
export function exposureFactor({ shade, surface }: ExposureSetting): number {
  const sky = shade ? SHADE_FACTORS[shade] : 1
  const reflected = surface ? SURFACE_REFLECTANCE[surface] : 0
  return sky + reflected
}

/**
 * UV adjusted for the activity's shade and surface, rounded up to one decimal so the
 * rounding never makes an hour look safer. Unchanged without a setting; a non-finite
 * value stays as it is.
 */
export function exposedUV(uv: number, setting: ExposureSetting): number {
  const factor = exposureFactor(setting)
  if (factor === 1 || !Number.isFinite(uv)) return uv
  return Math.ceil(Math.round(uv * factor * 1e6) / 1e5) / 10
}
