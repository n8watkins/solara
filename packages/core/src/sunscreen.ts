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
const AREA_WORDS: Readonly<Record<BodyArea, string>> = Object.freeze({
  face: 'face',
  arms: 'arms',
  legs: 'legs',
  torso: 'body',
})

// Preset activity ids (tiers.ts ACTIVITY_CATEGORIES). Swimwear for the water; long
// trousers, or sitting at a table, for a few; a T-shirt and shorts for the rest and for
// custom activities, the exposure the vitamin D estimate assumes (arms and legs).
const SWIMWEAR = new Set(['swim', 'surf', 'paddle'])
const FACE_AND_ARMS = new Set(['baseball', 'coffee', 'lunch', 'read'])

/** The parts an activity usually leaves in the sun, from its preset id. */
export function activityBodyAreas(id: string | undefined): readonly BodyArea[] {
  const preset = id ?? ''
  if (SWIMWEAR.has(preset)) return BODY_AREAS
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

/** "face", "face and arms", "face, arms and legs". */
function listAreas(areas: readonly BodyArea[]): string {
  const words = areas.map(area => AREA_WORDS[area])
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

function teaspoonsWord(n: number): string {
  return n === 1 ? 'teaspoon' : 'teaspoons'
}

/**
 * The amount in a sentence: "About 5 teaspoons (25 mL) for your face, arms and legs",
 * "About 7 teaspoons (35 mL), a shot glass, for your whole body".
 */
export function sunscreenAmountText(amount: SunscreenAmount): string {
  const { teaspoons, ml } = amount
  const how = `About ${teaspoons} ${teaspoonsWord(teaspoons)} (${ml}\u00a0mL)`
  return amount.wholeBody
    ? `${how}, a shot glass, for your whole body`
    : `${how} for your ${listAreas(amount.areas)}`
}

/** The amount for a card's row: "about 5 tsp for face, arms, legs", "about 7 tsp, whole body". */
export function sunscreenAmountShort(amount: SunscreenAmount): string {
  const how = `about ${amount.teaspoons} tsp`
  return amount.wholeBody
    ? `${how}, whole body`
    : `${how} for ${amount.areas.map(a => AREA_WORDS[a]).join(', ')}`
}

/** The teaspoon rule, part by part. */
export const TEASPOON_RULE =
  'About 1 teaspoon (5\u00a0mL) for each part: face, neck and ears; each arm; each leg; the front of your body; the back of your body.'

/** Why an SPF is advised. */
export type SpfReason = 'low-uv' | 'standard' | 'very-high-uv' | 'fair-skin'

export interface SpfAdvice {
  /** The least SPF to use, or null when the UV stays under 3. */
  spf: 30 | 50 | null
  reason: SpfReason
}

/** Fitzpatrick types I and II: always or usually burn. */
function burnsEasily(skin: SkinType): boolean {
  const type = FITZPATRICK_TYPES[skin]
  return type === 'I' || type === 'II'
}

/**
 * The SPF to use at a UV index (the day's peak, judged on the clear sky as protection
 * advice is: protection.ts) for a skin type. The index reads whole numbers, so 2.5 is 3.
 */
export function spfAdvice(uv: number, skin: SkinType): SpfAdvice {
  const index = Math.round(uv)
  if (!(index >= PROTECT_FROM_UV)) return { spf: null, reason: 'low-uv' }
  if (index >= SHADE_FROM_UV) return { spf: 50, reason: 'very-high-uv' }
  if (burnsEasily(skin)) return { spf: 50, reason: 'fair-skin' }
  return { spf: 30, reason: 'standard' }
}

/**
 * The advice in a sentence, for a day whose UV peaks at `uv`: "SPF 50+ broad spectrum:
 * UV reaches 9.1 (Very high) today." Durations and UV values in the app's one style.
 */
export function spfAdviceText(advice: SpfAdvice, uv: number, skin: SkinType): string {
  const reading = `${formatUV(uv)} (${uvLabel(uv)})`
  switch (advice.reason) {
    case 'low-uv':
      return `UV peaks at ${reading} today: most people need no sunscreen below UV ${PROTECT_FROM_UV}.`
    case 'very-high-uv':
      return `SPF 50+ broad spectrum: UV reaches ${reading} today.`
    case 'fair-skin':
      return `SPF 50+ broad spectrum: UV reaches ${reading} today, and type ${FITZPATRICK_TYPES[skin]} skin burns easily.`
    case 'standard':
      return `SPF 30+ broad spectrum: UV reaches ${reading} today.`
  }
}

/** The rule for a skin type on any day, for Settings: no UV reading needed. */
export function spfRuleText(skin: SkinType): string {
  return burnsEasily(skin)
    ? `With type ${FITZPATRICK_TYPES[skin]} skin, use SPF 50+ broad spectrum whenever UV is ${PROTECT_FROM_UV} or more.`
    : `Use SPF 30+ broad spectrum whenever UV is ${PROTECT_FROM_UV} or more, and SPF 50+ when it reaches ${SHADE_FROM_UV}.`
}

/** When to put it on and again: "Put it on 20 min before you go out. Reapply every 2 h, ..." */
export const REAPPLY_RULE = `Put it on ${formatDuration(20)} before you go out. Reapply every ${formatDuration(
  REAPPLY_MINUTES.standard,
)}, and straight after swimming, sweating or towelling off.`
