// The one vitamin D estimate: the dashboard's vitamin D card (its minutes) and the vitamin
// D log (each session's IU and burn risk) both come from here, so the two never disagree,
// and the future Android app reuses it (ROADMAP item 48). Pure and small: the card is in
// the first load, so the log's storage and schema live apart (vitamin-d-log.ts).
//
// The model, every number of it an estimate:
// - A session's dose is its share of a burn dose (minimal erythema dose), the burn model of
//   burnMins: each minute at UV u adds u / (SKIN_BURN_BASE[skin] x 10).
// - About VITD_DOSE_IU (1,000 IU) of vitamin D for VITD_BURN_SHARE (0.3) of a burn dose
//   with arms and legs bare, the rule of thumb most guidance repeats (Holick, Am J Clin
//   Nutr 2004), in proportion to the dose and to how much skin is uncovered
//   (EXPOSURE_FACTOR).
// - Minutes under VITD_MIN_UV count toward the burn but make no vitamin D: the card's
//   "UV too low". There is no other floor; a low sun simply counts slowly (REVIEW10
//   VERIFY10 I3 found a UV 3 floor wrong).
// - Skin makes no more vitamin D past about one burn dose (previtamin D reaches its
//   equilibrium; Holick, MacLaughlin and Doppelt, Science 1981), so the dose counted for
//   vitamin D stops at 1: time past the burn time adds none.
// - Sunscreen divides the UV by SUNSCREEN_UV_FACTOR for both the burn and the vitamin D,
//   the factor the plans already use for SPF 30+ (effectiveMaxUV); as people apply it, it
//   blocks far less than its label (Neale and others, Br J Dermatol 2019;181:907).
// - Age is not modelled: older skin makes much less (MacLaughlin and Holick, J Clin Invest
//   1985), which the help text says.
import { SKIN_BURN_BASE, SUNSCREEN_UV_FACTOR, type SkinType } from './recommendation'

/**
 * The vitamin D dose the card's minutes stand for: about 1,000 IU for an adult with arms
 * and legs bare in roughly a third of the time it takes the skin to redden (Holick, Am J
 * Clin Nutr 2004; the rule of thumb most guidance repeats).
 */
export const VITD_DOSE_IU = 1000

/** The share of a burn dose that gives VITD_DOSE_IU on arms and legs. */
export const VITD_BURN_SHARE = 0.3

/** Below this UV the estimate counts no vitamin D ("UV too low"). */
export const VITD_MIN_UV = 1

/**
 * A commonly cited daily amount, for comparison only: 600 IU (15 mcg) a day for adults up
 * to 70, 800 IU over 70 (US National Academies, Dietary Reference Intakes for Calcium and
 * Vitamin D, 2011; NIH Office of Dietary Supplements, Vitamin D fact sheet). It is an
 * intake from food and supplements, not a target for the sun.
 */
export const DAILY_REFERENCE_IU = 600
export const DAILY_REFERENCE_IU_OVER_70 = 800

/** How much skin a session leaves in the sun. */
export type SkinExposure = 'face-hands' | 'face-arms' | 'arms-legs' | 'swimwear'

/** Every preset, least skin first. */
export const SKIN_EXPOSURES: readonly SkinExposure[] = Object.freeze([
  'face-hands',
  'face-arms',
  'arms-legs',
  'swimwear',
])

/**
 * Vitamin D relative to the card's arms and legs (a T-shirt and shorts), from the share of
 * the body each preset leaves bare (about 10%, 25%, 45% and 85%, Lund and Browder chart),
 * rounded: rough on purpose.
 */
export const EXPOSURE_FACTOR: Readonly<Record<SkinExposure, number>> = Object.freeze({
  'face-hands': 0.25,
  'face-arms': 0.5,
  'arms-legs': 1,
  swimwear: 2,
})

export function isSkinExposure(value: unknown): value is SkinExposure {
  return typeof value === 'string' && (SKIN_EXPOSURES as readonly string[]).includes(value)
}

/** Minutes to about VITD_DOSE_IU of vitamin D at `uv` (0.3 x the burn time), or null below UV 1. */
export function vitDMins(uv: number, skinType: SkinType): number | null {
  if (uv < VITD_MIN_UV) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.max(1, Math.round((base * VITD_BURN_SHARE * 10) / uv))
}

/** A stretch of a session at one UV. */
export interface UvSpan {
  minutes: number
  uv: number
}

export interface SessionInput {
  /** The session's minutes and the UV of each stretch (the forecast's hours, or one entered UV). */
  spans: readonly UvSpan[]
  skinType: SkinType
  exposure: SkinExposure
  sunscreen: boolean
}

export interface SessionEstimate {
  /** Estimated vitamin D, IU (unrounded; show it with roundIu). */
  iu: number
  /** The session's share of a burn dose: 1 is the burn time, more is past it. */
  burnShare: number
  /** The session's length, minutes. */
  minutes: number
  /**
   * Minutes to a burn at the session's average UV (with sunscreen, as counted), so
   * `minutes` of `burnMinutes`; null when the UV is too low to burn.
   */
  burnMinutes: number | null
  /** The session's average UV, minute by minute. */
  meanUv: number
  /** Some minutes were under VITD_MIN_UV, which count no vitamin D. */
  lowUv: boolean
  /** The session went past one burn dose, and the time past it added no vitamin D. */
  capped: boolean
}

/** The session's vitamin D and burn risk. */
export function estimateSession({
  spans,
  skinType,
  exposure,
  sunscreen,
}: SessionInput): SessionEstimate {
  const burnDoseUvMinutes = SKIN_BURN_BASE[skinType] * 10
  const protection = sunscreen ? SUNSCREEN_UV_FACTOR : 1
  let minutes = 0
  let uvMinutes = 0
  let vitDUvMinutes = 0
  let lowUv = false
  for (const span of spans) {
    if (!(span.minutes > 0)) continue
    const uv = Math.max(0, span.uv)
    minutes += span.minutes
    uvMinutes += span.minutes * uv
    if (uv >= VITD_MIN_UV) vitDUvMinutes += span.minutes * uv
    else lowUv = true
  }
  const burnShare = uvMinutes / protection / burnDoseUvMinutes
  const vitDShare = vitDUvMinutes / protection / burnDoseUvMinutes
  const meanUv = minutes > 0 ? uvMinutes / minutes : 0
  const effectiveUv = meanUv / protection
  return {
    iu: (VITD_DOSE_IU * EXPOSURE_FACTOR[exposure] * Math.min(vitDShare, 1)) / VITD_BURN_SHARE,
    burnShare,
    minutes,
    burnMinutes: effectiveUv > 0 ? Math.max(1, Math.round(burnDoseUvMinutes / effectiveUv)) : null,
    meanUv,
    lowUv,
    capped: vitDShare > 1,
  }
}

/** How close a session came to the burn time. */
export type BurnRisk = 'well-under' | 'close' | 'past'

export function burnRisk(burnShare: number): BurnRisk {
  if (burnShare >= 1) return 'past'
  if (burnShare >= 0.5) return 'close'
  return 'well-under'
}

/** IU to show, to the nearest 50; a session above 0 that rounds to 0 reads "under 50 IU". */
export function roundIu(iu: number): number {
  return iu > 0 ? Math.round(iu / 50) * 50 : 0
}

/**
 * The UV of each stretch of a session from an hourly forecast, minute by minute: a session
 * from 9:40 for 50 minutes is 20 minutes at the 9am hour's UV and 30 at 10am's. Hours the
 * forecast lacks count as UV 0. `startHour` is fractional (9.5 is 9:30).
 */
export function forecastSpans(
  hourly: readonly { hour: number; uv: number }[],
  startHour: number,
  minutes: number,
): UvSpan[] {
  const uvAt = new Map(hourly.map(h => [h.hour, h.uv]))
  const spans: UvSpan[] = []
  let at = startHour * 60
  const end = at + Math.max(0, minutes)
  while (at < end - 1e-9) {
    const hour = Math.floor(at / 60 + 1e-9)
    const next = Math.min(end, (hour + 1) * 60)
    spans.push({ minutes: next - at, uv: uvAt.get(hour) ?? 0 })
    at = next
  }
  return spans
}
