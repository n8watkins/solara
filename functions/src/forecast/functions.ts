// Forecast Cloud Functions: the cached forecast proxy and place search for the Open-Meteo
// commercial API.

import { onRequest } from 'firebase-functions/v2/https'

import { browserApi, costGuard } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import { CallerShare, browserUpstreamLimits } from './caller-share'
import {
  FORECAST_PROXY_ENABLED,
  OPEN_METEO_API_KEY,
  UPSTREAM_SHARE_PER_CALLER,
  commercialProvider,
  placeSearchLimits,
  upstreamLimits,
} from './config'
import { forecastHandler, placeSearchHandler } from './endpoints'
import { PlaceSearchCache } from './place-search'
import { ForecastCache } from './proxy'
import { UpstreamBudget } from './upstream-budget'

const enabled = () => FORECAST_PROXY_ENABLED.value()
const sharePerCaller = () => UPSTREAM_SHARE_PER_CALLER.value()

const cache = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  upstreamAllowed: async () => !(await costGuard.engaged()),
  // The same counters as the feed's and the heads-ups' budget, but only two thirds of
  // them: a flood of browser callers cannot take the rest (REVIEW5 L1, caller-share.ts).
  upstreamBudget: new UpstreamBudget({ db, limits: () => browserUpstreamLimits(upstreamLimits()) }),
})

// Guests call it too, so there is no ID token: App Check and the per-address limit
// guard it, and the cache, each caller's share and the global upstream budget bound
// what any number of callers can cost upstream (REVIEW4 H1).
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
    handler: forecastHandler({
      enabled,
      cache,
      share: new CallerShare({ db, scope: 'forecast', perHour: sharePerCaller }),
    }),
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
  upstreamBudget: new UpstreamBudget({
    db,
    label: 'place search',
    prefix: 'places-',
    limits: placeSearchLimits,
  }),
})

// The app's place search once the forecast proxy is on (finding L3): Open-Meteo's
// geocoding on the commercial plan, behind the same App Check and limits, with its own
// budget and caller shares, so searches and forecasts cannot starve each other (H1).
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
    handler: placeSearchHandler({
      enabled,
      places,
      share: new CallerShare({ db, scope: 'places', perHour: sharePerCaller }),
    }),
  }),
)
