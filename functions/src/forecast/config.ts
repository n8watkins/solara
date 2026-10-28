// Forecast licensing configuration (decision D5): the Open-Meteo commercial API key in
// Secret Manager, and the switch that turns the forecast proxy on.

import { type ForecastProvider, openMeteoCommercial } from '#core'
import { defineBoolean, defineSecret } from 'firebase-functions/params'

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
