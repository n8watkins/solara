// Forecast Cloud Functions: the cached forecast proxy for the Open-Meteo commercial API.

import { onRequest } from 'firebase-functions/v2/https'

import { browserApi, costGuard } from '../shared/browser-api'
import { HttpError } from '../shared/errors'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import { FORECAST_PROXY_ENABLED, OPEN_METEO_API_KEY, commercialProvider } from './config'
import { ForecastCache, requestedPlace } from './proxy'

const cache = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  upstreamAllowed: async () => !(await costGuard.engaged()),
})

// Guests call it too, so there is no ID token: App Check and the per-address limit
// guard it, and the cache bounds what any number of callers can cost upstream.
export const forecast = onRequest(
  httpOptions({
    maxInstances: 5,
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
