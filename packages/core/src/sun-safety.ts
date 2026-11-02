// What protection a UV level and a planned activity call for (ROADMAP items 45 and 56):
// the SPF, whether the activity fits the burn time unprotected or with sunscreen, and
// which of "slip, slop, slap, seek, slide" matter at the level. One decision for the
// activity cards, the hero, the daily briefing, the Pro morning alert and a native client,
// so they never give two answers. Pure, with no words: the briefing (first load) and the
// sunscreen guidance (on demand) each say it in their own sentences.
//
// Sources (docs/SUNSCREEN.md): the WHO's Global Solar UV Index guide (protection from UV 3,
// extra protection and midday shade from 8), Cancer Council Australia's "Slip, Slop, Slap,
// Seek, Slide" and sunscreen guidance, and the burn model in recommendation.ts.
import { PROTECT_FROM_UV, SHADE_FROM_UV } from './protection'
import { REAPPLY_MINUTES } from './reapply-interval'
import { burnMins, FITZPATRICK_TYPES, SUNSCREEN_UV_FACTOR, type SkinType } from './recommendation'

/** Why an SPF is advised. */
export type SpfReason = 'low-uv' | 'standard' | 'very-high-uv' | 'fair-skin'

export interface SpfAdvice {
  /** The least SPF to use, or null when the UV stays under 3. */
  spf: 30 | 50 | null
  reason: SpfReason
}

/** Fitzpatrick types I and II: always or usually burn. */
export function burnsEasily(skin: SkinType): boolean {
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
 * Which protection a UV level calls for, by the WHO categories on the whole-number index:
 * 'low' (under 3: little needed), 'protect' (3 to 7: a shirt, sunscreen, a hat and
 * sunglasses) or 'shade' (8 or more: all of that, and shade around midday).
 */
export type SunSafetyLevel = 'low' | 'protect' | 'shade'

export function sunSafetyLevel(uv: number): SunSafetyLevel {
  const index = Math.round(uv)
  if (!(index >= PROTECT_FROM_UV)) return 'low'
  return index >= SHADE_FROM_UV ? 'shade' : 'protect'
}

// Preset activity ids (tiers.ts ACTIVITY_CATEGORIES) done in the water, in swimwear.
const WATER = new Set(['swim', 'surf', 'paddle'])

/** Whether an activity is done in the water (its preset id): swimwear, and a shorter reapply. */
export function isWaterActivity(id: string | undefined): boolean {
  return WATER.has(id ?? '')
}

/** The parts of an activity the fit reads. */
export interface FitActivity {
  /** The preset id, if any: water activities reapply sooner. */
  id?: string
  durationMins?: number | null
}

/**
 * Whether the activity fits: 'fits' unprotected, with 'sunscreen', or 'too-long' even with
 * sunscreen.
 */
export type FitVerdict = 'fits' | 'sunscreen' | 'too-long'

export interface BurnFit {
  verdict: FitVerdict
  /** The UV it is judged at: the highest the skin gets during the activity. */
  uv: number
  /** Minutes to a burn without sunscreen at `uv`, or null when the UV is negligible. */
  burnMins: number | null
  /** Minutes to a burn with sunscreen (SUNSCREEN_UV_FACTOR), or null when negligible. */
  protectedMins: number | null
  /** The SPF to name: the guidance's for `uv` and the skin type, never less than 30. */
  spf: 30 | 50
  /** With 'sunscreen', how often to reapply when the activity lasts longer than that; else null. */
  reapplyMins: number | null
}

/**
 * Whether an activity of its duration fits the burn time at `uv` (the highest UV the
 * skin gets during it) for a skin type (the plan's: in a group, the most sensitive
 * person's): unprotected, with sunscreen (the burn time times SUNSCREEN_UV_FACTOR, the
 * SPF 30+ the plans count on), or not even with sunscreen. A duration equal to the burn
 * time fits.
 */
export function burnFit(activity: FitActivity, uv: number, skin: SkinType): BurnFit {
  const duration = Math.max(0, activity.durationMins ?? 0)
  const unprotected = burnMins(uv, skin)
  const withSunscreen = burnMins(uv / SUNSCREEN_UV_FACTOR, skin)
  const verdict: FitVerdict =
    unprotected === null || duration <= unprotected
      ? 'fits'
      : withSunscreen === null || duration <= withSunscreen
        ? 'sunscreen'
        : 'too-long'
  const every = REAPPLY_MINUTES[isWaterActivity(activity.id) ? 'water' : 'standard']
  return {
    verdict,
    uv,
    burnMins: unprotected,
    protectedMins: withSunscreen,
    spf: spfAdvice(uv, skin).spf ?? 30,
    reapplyMins: verdict === 'sunscreen' && duration > every ? every : null,
  }
}

/** One hour the fit reads: its UV, and the UV the activity's skin gets when known. */
export interface FitHour {
  hour: number
  uv: number
  planningUV?: number
}

/**
 * The highest UV the skin gets over [from, to) (fractional hours): each hour's planning
 * UV (its forecast UV when not given), over every hour the span touches, to a tenth.
 */
export function peakUVIn(hours: readonly FitHour[], from: number, to: number): number {
  let peak = 0
  for (const h of hours) {
    const uv = h.planningUV ?? h.uv
    if (h.hour + 1 > from && h.hour < Math.max(to, from + 1e-9) && Number.isFinite(uv)) {
      peak = Math.max(peak, uv)
    }
  }
  return Math.round(peak * 10) / 10
}

/** An activity placed in a span, with its fit there. */
export interface PlacedFit {
  from: number
  to: number
  fit: BurnFit
}

/**
 * The activity placed where the UV is lowest inside `span` (the earliest such start), with
 * its fit there; null when the span is shorter than the activity. The UV changes only at
 * whole hours, so the starts worth trying are the span's start and each whole hour up to
 * the latest start (a later start than that hour touches the same hours and more).
 */
export function bestFitIn(
  hours: readonly FitHour[],
  span: { from: number; to: number },
  activity: FitActivity,
  skin: SkinType,
): PlacedFit | null {
  const length = Math.max(0, activity.durationMins ?? 0) / 60
  const last = span.to - length
  if (last < span.from) return null
  const starts = [span.from]
  for (let hour = Math.ceil(span.from); hour <= last; hour++) starts.push(hour)
  let best: { from: number; uv: number } | null = null
  for (const from of starts) {
    const uv = peakUVIn(hours, from, from + length)
    if (!best || uv < best.uv) best = { from, uv }
  }
  return { from: best!.from, to: best!.from + length, fit: burnFit(activity, best!.uv, skin) }
}
