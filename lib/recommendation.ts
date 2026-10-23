import type { Activity, PreferredHours, SafeActivityWindow, SkinType } from './types'

type RecommendationHour = {
  hour: number
  uv: number
  planningUV?: number
}

type RecommendationEngine = {
  SKIN_BURN_BASE: Readonly<Record<SkinType, number>>
  effectiveMaxUV: (activity: Pick<Activity, 'maxUV' | 'sunscreen'>) => number
  burnMins: (uv: number, skinType: SkinType) => number | null
  weekdayForDate: (dateStr: string) => number | null
  runsOn: (activity: Pick<Activity, 'daysOfWeek'>, dateStr: string) => boolean
  findWindows: (
    hourly: RecommendationHour[],
    maxUV: number,
    durationMins?: number,
    preferredHours?: PreferredHours,
  ) => SafeActivityWindow[]
  bestWindow: (
    hourly: RecommendationHour[],
    maxUV: number,
    durationMins?: number,
    preferredHours?: PreferredHours,
  ) => SafeActivityWindow | null
}

// This is the same portable implementation deployed with Cloud Functions.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require('../functions/lib/recommendation-engine') as RecommendationEngine

export const SKIN_BURN_BASE = engine.SKIN_BURN_BASE
export const effectiveMaxUV = engine.effectiveMaxUV
export const burnMins = engine.burnMins
export const weekdayForDate = engine.weekdayForDate
export const activityRunsOnDate = engine.runsOn
export const findRecommendationWindows = engine.findWindows
export const bestRecommendationWindow = engine.bestWindow
