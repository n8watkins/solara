// Forecast licensing configuration (decision D5): the Open-Meteo commercial API key in
// Secret Manager, and the switch that turns the forecast proxy on.

import { type ForecastProvider, openMeteoCommercial, openMeteoFree } from '#core'
import { defineBoolean, defineInt, defineSecret } from 'firebase-functions/params'

import type { UpstreamLimits } from './upstream-budget'

/**
 * The Open-Meteo commercial API key. Create the secret before the first Functions
 * deploy, with the value `unset` until the plan is bought (docs/OWNER_CHECKLIST.md).
 */
export const OPEN_METEO_API_KEY = defineSecret('OPEN_METEO_API_KEY')

/**
 * Whether the `forecast` Function serves forecasts. Off until the owner switches it on
 * (the FORECAST_PROXY_ENABLED repository variable); the browser calls Open-Meteo
 * directly until then.
 */
export const FORECAST_PROXY_ENABLED = defineBoolean('FORECAST_PROXY_ENABLED', { default: false })

/**
 * The commercial provider, or null while the key is the `unset` placeholder or empty.
 * Only inside the Functions emulator may OPEN_METEO_API_BASE point it at a local
 * stand-in (the signed-in e2e suite); a deployed function always calls Open-Meteo.
 */
export function commercialProvider(
  apiKey: string = OPEN_METEO_API_KEY.value(),
): ForecastProvider | null {
  const key = apiKey.trim()
  if (!key || key === 'unset') return null
  const base = process.env.FUNCTIONS_EMULATOR === 'true' ? process.env.OPEN_METEO_API_BASE : ''
  if (base && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(base)) {
    throw new Error('OPEN_METEO_API_BASE must be a loopback address')
  }
  return base ? openMeteoCommercial(key, base) : openMeteoCommercial(key)
}

/**
 * The global budget for upstream calls from the traffic-driven paths (the proxy and the
 * calendar feed; finding M1), per UTC hour and day. Defaults, owner may change: 20,000 a
 * day is 60% of the Standard plan's 1 million calls a month (about 33,000 a day), which
 * leaves the rest for the Pro alerts; 1,500 an hour keeps a burst from spending the day
 * in one hour. docs/DEPLOYMENT.md ("Forecast proxy") explains the sizing.
 */
export const FORECAST_UPSTREAM_PER_HOUR = defineInt('FORECAST_UPSTREAM_PER_HOUR', {
  default: 1500,
})
export const FORECAST_UPSTREAM_PER_DAY = defineInt('FORECAST_UPSTREAM_PER_DAY', {
  default: 20000,
})

export function upstreamLimits(): UpstreamLimits {
  return { perHour: FORECAST_UPSTREAM_PER_HOUR.value(), perDay: FORECAST_UPSTREAM_PER_DAY.value() }
}

/**
 * The provider for the calendar feed: the commercial API once its key is set; until
 * then Open-Meteo's free API, but only while billing is off (no Pro is sold, so the use
 * is non-commercial). Once billing is on without a key, null: the feed serves what is
 * cached and otherwise fails closed instead of using the free API commercially (L3).
 */
export function feedForecastProvider(
  billingEnabled: boolean,
  apiKey: string = OPEN_METEO_API_KEY.value(),
): ForecastProvider | null {
  return commercialProvider(apiKey) ?? (billingEnabled ? null : openMeteoFree)
}
