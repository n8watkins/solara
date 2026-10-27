// Calendar feed Cloud Functions: minting and revoking the feed link, and the feed itself.

import { buildICS } from '#core'
import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'

import { authenticate, uidLimiter } from '../shared/auth'
import { browserApi, costGuard } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions } from '../shared/options'
import { OPEN_METEO_API_KEY, commercialProvider } from '../forecast/config'
import { createCalendarFeedHandler } from './calendar-feed'
import { buildSunEvents, fetchForecast } from './sun'
import { revokeCalendarFeed as revokeFeed, rotateCalendarFeed as rotateFeed } from './tokens'

/** Minting or revoking a feed link is a deliberate action, a few times a minute at most. */
const rotateLimiter = uidLimiter(5)
const revokeLimiter = uidLimiter(5)

export const rotateCalendarFeed = onRequest(
  httpOptions({ maxInstances: 3, timeoutSeconds: 30 }),
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
  httpOptions({ maxInstances: 3, timeoutSeconds: 30 }),
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

// Token-authorized (calendar apps cannot send App Check tokens) and rate limited per
// feed and per address; see calendar-feed.ts.
export const calendarFeed = onRequest(
  {
    ...httpOptions({
      maxInstances: 5,
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
    // The commercial API once its key is set (decision D5).
    fetchForecast: (lat, lon, days) =>
      fetchForecast(lat, lon, days, { provider: commercialProvider() ?? undefined }),
  }),
)
