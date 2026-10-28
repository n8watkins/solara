// Calendar feed Cloud Functions: minting and revoking the feed link, and the feed itself.

import { buildICS } from '#core'
import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'

import { authenticate, uidLimiter } from '../shared/auth'
import { browserApi, costGuard } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import { BILLING_ENABLED } from '../billing/config'
import { OPEN_METEO_API_KEY, feedForecastProvider, upstreamLimits } from '../forecast/config'
import { ForecastCache } from '../forecast/proxy'
import { UpstreamBudget } from '../forecast/upstream-budget'
import { createCalendarFeedHandler } from './calendar-feed'
import { buildSunEvents, parseSunForecast } from './sun'
import { revokeCalendarFeed as revokeFeed, rotateCalendarFeed as rotateFeed } from './tokens'

/** Minting or revoking a feed link is a deliberate action, a few times a minute at most. */
const rotateLimiter = uidLimiter(5)
const revokeLimiter = uidLimiter(5)

export const rotateCalendarFeed = onRequest(
  httpOptions({ name: 'rotateCalendarFeed', timeoutSeconds: 30 }),
  browserApi({
    name: 'rotateCalendarFeed',
    method: 'POST',
    appCheckMode: 'standard',
    costFeature: 'feedLinks',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization, {
        limiter: rotateLimiter,
      })
      return { body: await rotateFeed({ db, uid: identity.uid }) }
    },
  }),
)

// Revoking stays available while the cost guard is on: it only removes a link.
export const revokeCalendarFeed = onRequest(
  httpOptions({ name: 'revokeCalendarFeed', timeoutSeconds: 30 }),
  browserApi({
    name: 'revokeCalendarFeed',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization, {
        limiter: revokeLimiter,
      })
      return { body: await revokeFeed({ db, uid: identity.uid }) }
    },
  }),
)

// The feed reads forecasts through the same Firestore-backed cache as the proxy and the
// alerts (one upstream call per place and hour across the app), within the same global
// upstream budget on the server's side of it (shared with event heads-ups, so the browser
// cannot starve it nor it the browser; REVIEW6 L3), and each feed may cause only a few
// upstream calls an hour (finding M3).
// The feed answers 503 while the cost guard is engaged, so no upstream call then either.
// Until the commercial key is set (billing off), its provider is Open-Meteo's free API,
// whose forecasts the cache keeps in this instance's memory and never writes to the
// shared cache, so the proxy can never serve them (REVIEW4 L7, forecast/proxy.ts).
const feedForecasts = new ForecastCache({
  db,
  provider: () => feedForecastProvider(BILLING_ENABLED.value()),
  upstreamAllowed: async () => !(await costGuard.engaged()),
  upstreamBudget: new UpstreamBudget({ db, limits: upstreamLimits, side: 'server' }),
})

// Token-authorized (calendar apps cannot send App Check tokens) and rate limited per
// feed and per address; see calendar-feed.ts.
export const calendarFeed = onRequest(
  {
    ...httpOptions({
      name: 'calendarFeed',
      concurrency: 40,
      timeoutSeconds: 30,
      secrets: [OPEN_METEO_API_KEY],
    }),
    cors: false,
  },
  createCalendarFeedHandler({
    buildICS,
    buildSunEvents,
    costGuard,
    db,
    // The commercial API once its key is set (decision D5); see feedForecastProvider.
    fetchForecast: async (location, days, lookup) =>
      parseSunForecast(await feedForecasts.get(location, lookup), days, location),
  }),
)
