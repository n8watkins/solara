// The request handlers behind the `forecast` and `placeSearch` Functions, apart from the
// deployment wiring in functions.ts so tests can drive the real pipeline.

import type { GeocodingResult, OpenMeteoResponse } from '#core'
import type { Request } from 'firebase-functions/v2/https'

import { clientScopes } from '../shared/client-address'
import { HttpError } from '../shared/errors'
import type { ApiResult } from '../shared/http'
import type { LimitScope } from '../shared/rate-limit'
import { type PlaceSearchCache, requestedSearch } from './place-search'
import { type ForecastCache, requestedPlace } from './proxy'

/** Charges one upstream call to a caller's share (caller-share.ts). */
export interface Share {
  take: (caller: readonly LimitScope[]) => Promise<boolean>
}

/**
 * The proxy's answer: Open-Meteo's shape, plus `stale: true` and `fetchedAt` when it is
 * the last good copy from an earlier hour because the budget or the caller's share is
 * spent (REVIEW4 H1). The app's parser ignores keys it does not know.
 */
export type ForecastBody = OpenMeteoResponse & { stale?: true; fetchedAt?: string }

export function forecastHandler({
  enabled,
  cache,
  share,
}: {
  enabled: () => boolean
  cache: Pick<ForecastCache, 'lookup'>
  share: Share
}): (req: Request) => Promise<ApiResult<ForecastBody>> {
  return async req => {
    if (!enabled()) throw new HttpError('unavailable', 'Forecast proxy is not enabled')
    const caller = clientScopes(req)
    const served = await cache.lookup(requestedPlace(req.query), {
      mayFetch: () => share.take(caller),
    })
    const body: ForecastBody = served.stale
      ? { ...served.forecast, stale: true, fetchedAt: new Date(served.fetchedAt).toISOString() }
      : served.forecast
    return { body }
  }
}

export function placeSearchHandler({
  enabled,
  places,
  share,
}: {
  enabled: () => boolean
  places: Pick<PlaceSearchCache, 'search'>
  share: Share
}): (req: Request) => Promise<ApiResult<{ results: GeocodingResult[] }>> {
  return async req => {
    if (!enabled()) throw new HttpError('unavailable', 'Place search proxy is not enabled')
    const caller = clientScopes(req)
    return {
      body: await places.search(requestedSearch(req.query), {
        mayFetch: () => share.take(caller),
      }),
    }
  }
}
