// How much sunscreen, which SPF and when to reapply: the sunscreen timer, the activity
// cards and Settings coach with these words, so they never give two answers. Pure and
// small, with nothing stored: the amount follows an activity's preset (what people
// usually wear for it) and the advice the day's UV and the skin type already kept.
//
// Sources (docs/SUNSCREEN.md):
// - Amount: about a teaspoon (5 mL) for each part of the body (the face with the neck and
//   ears, each arm, each leg, the front and the back of the body), about 7 teaspoons
//   (35 mL, a shot glass) for a whole adult body (Cancer Council Australia's "teaspoon
//   rule"; the American Academy of Dermatology's "about 1 ounce, enough to fill a shot
//   glass").
// - SPF: broad spectrum SPF 30 or higher whenever the UV index is 3 or more (WHO, AAD,
//   Cancer Council), SPF 50+ when it is very high (8 or more, where the WHO also advises
//   shade at midday) or for fair skin that burns easily (Fitzpatrick types I and II).
// - Reapply: about 20 minutes before going out, again every 2 hours, and straight after
//   swimming, sweating or towelling off (Cancer Council, AAD, FDA water-resistance
//   labelling). The reapply timer (reapply.ts) keeps the times.
import { formatDuration } from './duration'
import { PROTECT_FROM_UV, SHADE_FROM_UV } from './protection'
import { REAPPLY_MINUTES } from './reapply'
import { FITZPATRICK_TYPES, type SkinType } from './recommendation'
import {
  burnsEasily,
  isWaterActivity,
  sunSafetyLevel,
  type BurnFit,
  type SpfAdvice,
} from './sun-safety'
import core from './messages/core'
import m from './messages/sunscreen'
import { formatUV, uvLabel } from './uv-scale'

/** The parts sunscreen amounts are counted in; `face` takes in the neck and ears. */
export type BodyArea = 'face' | 'arms' | 'legs' | 'torso'

/** Every part, in the order the words list them. */
export const BODY_AREAS: readonly BodyArea[] = Object.freeze(['face', 'arms', 'legs', 'torso'])

/** Teaspoons for each part: one for the face, one per arm, one per leg, one front, one back. */
export const AREA_TEASPOONS: Readonly<Record<BodyArea, number>> = Object.freeze({
  face: 1,
  arms: 2,
  legs: 2,
  torso: 2,
})

/** Millilitres in a teaspoon. Amounts keep the number and "mL" on one line (a no-break space). */
export const TEASPOON_ML = 5

/** What the words call each part. */
const AREA_WORDS: Readonly<Record<BodyArea, () => string>> = Object.freeze({
  face: () => m.areaFace,
  arms: () => m.areaArms,
  legs: () => m.areaLegs,
  torso: () => m.areaTorso,
})

// Preset activity ids (tiers.ts ACTIVITY_CATEGORIES). Swimwear for the water
// (isWaterActivity); long trousers, or sitting at a table, for a few; a T-shirt and shorts
// for the rest and for custom activities, the exposure the vitamin D estimate assumes
// (arms and legs).
const FACE_AND_ARMS = new Set(['baseball', 'coffee', 'lunch', 'read'])

/** The parts an activity usually leaves in the sun, from its preset id. */
export function activityBodyAreas(id: string | undefined): readonly BodyArea[] {
  const preset = id ?? ''
  if (isWaterActivity(preset)) return BODY_AREAS
  if (FACE_AND_ARMS.has(preset)) return ['face', 'arms']
  return ['face', 'arms', 'legs']
}

export interface SunscreenAmount {
  /** The parts covered, in BODY_AREAS order, each once. */
  areas: readonly BodyArea[]
  teaspoons: number
  ml: number
  /** Every part: the whole body. */
  wholeBody: boolean
}

/** How much sunscreen covers `areas`, at about a teaspoon per part. */
export function sunscreenAmount(areas: readonly BodyArea[]): SunscreenAmount {
  const covered = BODY_AREAS.filter(area => areas.includes(area))
  const teaspoons = covered.reduce((sum, area) => sum + AREA_TEASPOONS[area], 0)
  return {
    areas: covered,
    teaspoons,
    ml: teaspoons * TEASPOON_ML,
    wholeBody: covered.length === BODY_AREAS.length,
  }
}

/**
 * The amount in a sentence: "About 5 teaspoons (25 mL) for your face, arms and legs",
 * "About 7 teaspoons (35 mL), a shot glass, for your whole body".
 */
export function sunscreenAmountText(amount: SunscreenAmount): string {
  const { teaspoons, ml } = amount
  return amount.wholeBody
    ? m.amountTextWholeBody(teaspoons, ml)
    : m.amountText(teaspoons, ml, core.listAnd(amount.areas.map(area => AREA_WORDS[area]())))
}

/** The amount for a card's row: "about 5 tsp for face, arms, legs", "about 7 tsp, whole body". */
export function sunscreenAmountShort(amount: SunscreenAmount): string {
  return amount.wholeBody
    ? m.amountShortWholeBody(amount.teaspoons)
    : m.amountShort(amount.teaspoons, m.amountShortList(amount.areas.map(a => AREA_WORDS[a]())))
}

/** The teaspoon rule, part by part. */
export function teaspoonRule(): string {
  return m.teaspoonRule
}

// The SPF rule and the fit live with the rest of the protection decisions (sun-safety.ts),
// which the briefing reads on the first load without these words.
export { spfAdvice, type SpfAdvice, type SpfReason } from './sun-safety'

/**
 * The advice in a sentence, for a day whose UV peaks at `uv`: "SPF 50+ broad spectrum:
 * UV reaches 9.1 (Very high) today." Durations and UV values in the app's one style.
 */
export function spfAdviceText(advice: SpfAdvice, uv: number, skin: SkinType): string {
  const reading = `${formatUV(uv)} (${uvLabel(uv)})`
  switch (advice.reason) {
    case 'low-uv':
      return m.spfLowUv(reading, PROTECT_FROM_UV)
    case 'very-high-uv':
      return m.spfVeryHigh(reading)
    case 'fair-skin':
      return m.spfFairSkin(reading, FITZPATRICK_TYPES[skin])
    case 'standard':
      return m.spfStandard(reading)
  }
}

/** The rule for a skin type on any day, for Settings: no UV reading needed. */
export function spfRuleText(skin: SkinType): string {
  return burnsEasily(skin)
    ? m.spfRuleFair(FITZPATRICK_TYPES[skin], PROTECT_FROM_UV)
    : m.spfRule(PROTECT_FROM_UV, SHADE_FROM_UV)
}

/** When to put it on and again: "Put it on 20 min before you go out. Reapply every 2 h, ..." */
export function reapplyRule(): string {
  return m.reapplyRule(formatDuration(20), formatDuration(REAPPLY_MINUTES.standard))
}

/**
 * What else to wear at a UV level, after the SPF line ("slip, slop, slap, seek, slide"):
 * a shirt, a hat and sunglasses from UV 3, and shade around midday from 8; null under 3.
 */
export function sunGearText(uv: number): string | null {
  const level = sunSafetyLevel(uv)
  return level === 'low' ? null : level === 'shade' ? m.gearShade : m.gearProtect
}

/** The gear for any day, for Settings: no UV reading needed. */
export function sunGearRule(): string {
  return m.gearRule(PROTECT_FROM_UV, SHADE_FROM_UV)
}

/**
 * An activity's fit in a sentence, for its card and the hero (sun-safety.ts burnFit):
 * "Fits without sunscreen: you'd burn in about 1 h 10 min.", "Longer than your burn time
 * (about 38 min): fits with SPF 50+, reapplied every 2 h.", "Too long even with SPF 50+
 * (you'd burn in about 1 h 35 min): split it, or move it to 5pm-5:45pm." `moveTo` is the
 * slot where a too-long activity fits, already written as a time range.
 */
export function burnFitText(fit: BurnFit, moveTo: string | null = null): string {
  const burn = (minutes: number | null) => formatDuration(minutes ?? 0)
  switch (fit.verdict) {
    case 'fits':
      return fit.burnMins === null
        ? m.fitsNoBurn
        : sunSafetyLevel(fit.uv) === 'low'
          ? m.fitsUnprotected(burn(fit.burnMins))
          : m.fitsUnprotectedProtect(burn(fit.burnMins), fit.spf)
    case 'sunscreen':
      return m.fitsWithSunscreen(
        burn(fit.burnMins),
        fit.spf,
        fit.reapplyMins === null ? null : formatDuration(fit.reapplyMins),
      )
    case 'too-long':
      return moveTo
        ? m.tooLongMove(fit.spf, burn(fit.protectedMins), moveTo)
        : m.tooLongSplit(fit.spf, burn(fit.protectedMins))
  }
}
