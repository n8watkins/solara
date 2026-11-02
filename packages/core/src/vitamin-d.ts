// The vitamin D estimate's shared terms: the dashboard's vitamin D card (its minutes) and
// the vitamin D log's sessions (vitamin-d-session.ts) are both worked out from these, so
// the two never disagree, and the future Android app reuses them (ROADMAP item 48). Kept
// to the card's few lines because the card is in the first load: a bundler keeps a
// module whole, so the log's model lives in its own module, loaded with the log.
//
// About VITD_DOSE_IU (1,000 IU) of vitamin D for VITD_BURN_SHARE (0.3) of a burn dose
// (minimal erythema dose) with arms and legs bare, the rule of thumb most guidance repeats
// (Holick, Am J Clin Nutr 2004); under VITD_MIN_UV it counts none, the card's "UV too low".
import { SKIN_BURN_BASE, type SkinType } from './recommendation'

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

/** Minutes to about VITD_DOSE_IU of vitamin D at `uv` (0.3 x the burn time), or null below UV 1. */
export function vitDMins(uv: number, skinType: SkinType): number | null {
  if (uv < VITD_MIN_UV) return null
  const base = SKIN_BURN_BASE[skinType]
  return Math.max(1, Math.round((base * VITD_BURN_SHARE * 10) / uv))
}
