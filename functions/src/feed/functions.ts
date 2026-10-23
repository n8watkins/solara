// Calendar feed Cloud Functions: minting and revoking the feed link, and the feed itself.

import { buildICS } from '#core'
import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'

import { authenticate } from '../shared/auth'
import { browserApi } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { createCalendarFeedHandler } from './calendar-feed'
import { buildSunEvents, fetchForecast } from './sun'
import { revokeCalendarFeed as revokeFeed, rotateCalendarFeed as rotateFeed } from './tokens'

/** Days of forecast a feed covers. */
const FEED_DAYS = 7

export const rotateCalendarFeed = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'rotateCalendarFeed',
    method: 'POST',
    appCheckMode: 'standard',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization)
      return { body: await rotateFeed({ db, uid: identity.uid }) }
    },
  }),
)

export const revokeCalendarFeed = onRequest(
  { timeoutSeconds: 30, maxInstances: 10 },
  browserApi({
    name: 'revokeCalendarFeed',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Calendar feed unavailable',
    handler: async req => {
      const identity = await authenticate(getAuth(), req.headers.authorization)
      return { body: await revokeFeed({ db, uid: identity.uid }) }
    },
  }),
)

export const calendarFeed = onRequest(
  { cors: false, timeoutSeconds: 30, maxInstances: 20, concurrency: 20 },
  createCalendarFeedHandler({ buildICS, buildSunEvents, db, days: FEED_DAYS, fetchForecast }),
)
