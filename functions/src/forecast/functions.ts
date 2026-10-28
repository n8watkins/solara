// Forecast Cloud Functions: the cached forecast proxy and place search for the Open-Meteo
// commercial API.

import { onRequest } from 'firebase-functions/v2/https'

import { browserApi, costGuard } from '../shared/browser-api'
import { HttpError } from '../shared/errors'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import {
  FORECAST_PROXY_ENABLED,
  OPEN_METEO_API_KEY,
  commercialProvider,
  upstreamLimits,
} from './config'
import { PlaceSearchCache, requestedSearch } from './place-search'
import { ForecastCache, requestedPlace } from './proxy'
import { UpstreamBudget } from './upstream-budget'

const upstreamBudget = new UpstreamBudget({ db, limits: upstreamLimits })
const cache = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  upstreamAllowed: async () => !(await costGuard.engaged()),
  upstreamBudget,
})

// Guests call it too, so there is no ID token: App Check and the per-address limit
// guard it, and the cache and the global upstream budget bound what any number of
// callers can cost upstream.
export const forecast = onRequest(
  httpOptions({
    name: 'forecast',
    concurrency: 40,
    timeoutSeconds: 15,
    secrets: [OPEN_METEO_API_KEY],
  }),
  browserApi({
    name: 'forecast',
    method: 'GET',
    appCheckMode: 'standard',
    // Mobile carriers put many people behind one address; the cache absorbs the load.
    perAddressPerMinute: 120,
    fallbackMessage: 'Forecast unavailable',
    handler: async req => {
      if (!FORECAST_PROXY_ENABLED.value()) {
        throw new HttpError('unavailable', 'Forecast proxy is not enabled')
      }
      return { body: await cache.get(requestedPlace(req.query)) }
    },
  }),
)

/** The plan's key, or null while the secret holds the `unset` placeholder. */
function planKey(): string | null {
  const key = OPEN_METEO_API_KEY.value().trim()
  return key && key !== 'unset' ? key : null
}

const places = new PlaceSearchCache({
  apiKey: planKey,
  upstreamAllowed: async () => !(await costGuard.engaged()),
  upstreamBudget,
})

// The app's place search once the forecast proxy is on (finding L3): Open-Meteo's
// geocoding on the commercial plan, behind the same App Check, limits and budget.
export const placeSearch = onRequest(
  httpOptions({
    name: 'placeSearch',
    timeoutSeconds: 15,
    secrets: [OPEN_METEO_API_KEY],
  }),
  browserApi({
    name: 'placeSearch',
    method: 'GET',
    appCheckMode: 'standard',
    fallbackMessage: 'Place search unavailable',
    handler: async req => {
      if (!FORECAST_PROXY_ENABLED.value()) {
        throw new HttpError('unavailable', 'Place search proxy is not enabled')
      }
      return { body: await places.search(requestedSearch(req.query)) }
    },
  }),
)
