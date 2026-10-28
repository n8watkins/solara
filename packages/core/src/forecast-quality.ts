// How much to trust a forecast day, and how much its clouds lower UV. Shared so the
// dashboard, the week view and later alerts word it the same way, and the UV every
// planner judges an hour by (planningUV), so they all count clouds the same way.
//
// Open-Meteo's `uv_index` already accounts for the forecast clouds;
// `uv_index_clear_sky` is the same hour under a cloudless sky. The gap between the
// two is what the forecast clouds take off, and clouds are among the least
// predictable parts of a forecast, so the clear-sky value is what to expect if
// the sky stays clear.

import { exposedUV, type ExposureSetting } from './exposure'

/**
 * Forecast confidence by lead time: the first three days (today, tomorrow and the
 * day after) are 'high', days 4-6 'fair' and day 7 on 'low'. It reflects how far
 * ahead the day is, not this forecast's own spread, which the provider does not give.
 */
export type ForecastConfidence = 'high' | 'fair' | 'low'

/** Days from today (0 = today) up to which confidence stays high. */
export const HIGH_CONFIDENCE_DAYS = 3
/** Days from today up to which confidence is fair; later days are low. */
export const FAIR_CONFIDENCE_DAYS = 6

export function forecastConfidence(daysAhead: number): ForecastConfidence {
  if (daysAhead < HIGH_CONFIDENCE_DAYS) return 'high'
  if (daysAhead < FAIR_CONFIDENCE_DAYS) return 'fair'
  return 'low'
}

/** One line on a fair or low confidence day; null for high confidence. */
export function confidenceNote(confidence: ForecastConfidence): string | null {
  if (confidence === 'fair') return 'Fair confidence: UV and the best times can still change'
  if (confidence === 'low') return 'Low confidence: a rough guide, check again closer to the day'
  return null
}

/** The smallest gap, in whole UV index points, worth telling. Smaller gaps are noise. */
export const CLOUD_EFFECT_MIN = 2

export interface CloudEffect {
  /** The day's peak forecast UV, with clouds, as a whole number. */
  uv: number
  /** The day's peak clear-sky UV, as a whole number. */
  clearSky: number
}

/**
 * How much the forecast clouds lower a day's peak, in whole UV index points (no
 * false precision); null when the provider gave no clear-sky value or the gap is
 * under CLOUD_EFFECT_MIN.
 */
export function cloudEffect(
  hourly: readonly { uv: number; clearSkyUV?: number | null }[],
): CloudEffect | null {
  let uv = -Infinity
  let clearSky = -Infinity
  for (const hour of hourly) {
    uv = Math.max(uv, hour.uv)
    if (typeof hour.clearSkyUV === 'number') clearSky = Math.max(clearSky, hour.clearSkyUV)
  }
  if (!Number.isFinite(uv) || !Number.isFinite(clearSky)) return null
  const effect = { uv: Math.round(uv), clearSky: Math.round(clearSky) }
  return effect.clearSky - effect.uv >= CLOUD_EFFECT_MIN ? effect : null
}

/** "Clouds may cut UV to 4 from a clear-sky 7". */
export function cloudNote({ uv, clearSky }: CloudEffect): string {
  return `Clouds may cut UV to ${uv} from a clear-sky ${clearSky}`
}

/** One hour of forecast: UV with the forecast clouds, and under a clear sky when known. */
export interface SkyHour {
  uv: number
  clearSkyUV?: number | null
}

/**
 * The sky UV an activity plans on for one hour. `uv` already includes the forecast
 * clouds, so an activity that accounts for cloud cover plans on it as it is (counting
 * the clouds once); any other activity plans as if the sky were clear, which stays
 * safe when forecast clouds break up. Without a clear-sky value (an older cached
 * forecast) it falls back to `uv`.
 */
export function skyUV(hour: SkyHour, cloudSensitive?: boolean | null): number {
  if (cloudSensitive || typeof hour.clearSkyUV !== 'number') return hour.uv
  return Math.max(hour.uv, hour.clearSkyUV)
}

/**
 * The UV one hour is planned against for an activity: the sky UV (clouds counted
 * once, see skyUV) through the activity's shade and surface (exposure.ts). Every
 * surface that plans windows (the app, the calendar feed, the briefing) uses it.
 */
export function planningUV(
  hour: SkyHour,
  activity: { cloudSensitive?: boolean | null } & ExposureSetting,
): number {
  return exposedUV(skyUV(hour, activity.cloudSensitive), activity)
}
