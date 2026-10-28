// Linked calendar Cloud Functions (docs/integrations/EVENTS.md, phase 2): the endpoint
// that adds, refreshes and removes a link, and the scheduled refresh.

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import {
  EVENT_PLACE_LOOKUPS_PER_ACCOUNT,
  OPEN_METEO_API_KEY,
  eventPlaceLookupLimits,
} from '../forecast/config'
import { browserApi, costGuard } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions, scheduleOptions } from '../shared/options'
import { EVENTS_SUBSCRIPTIONS_ENABLED } from './config'
import { handleSubscriptionRequest } from './endpoint'
import { eventPlaceSearch } from './places'
import { fetchCalendar } from './safe-fetch'
import { type SubscriptionDeps, runSubscriptionRefresh } from './subscriptions'

/** The plan's key, or null while the secret holds the `unset` placeholder. */
function planKey(): string | null {
  const key = OPEN_METEO_API_KEY.value().trim()
  return key && key !== 'unset' ? key : null
}

const deps: SubscriptionDeps = {
  db,
  fetchCalendar: (url, validators) => fetchCalendar(url, validators),
  // A budget of its own, never place search's (REVIEW5 M1, places.ts). Without the key,
  // or once the budget or the account's share is spent, events with only LOCATION text
  // use the person's place, and the text is tried again on a later refresh.
  searchPlace: eventPlaceSearch({
    db,
    apiKey: planKey,
    upstreamAllowed: async () => !(await costGuard.engaged()),
    limits: eventPlaceLookupLimits,
    perAccountPerHour: () => EVENT_PLACE_LOOKUPS_PER_ACCOUNT,
  }),
}

// Signed-in accounts only; App Check, the per-address and per-account limits and the
// cost guard sit in front of every call. Each add or refresh fetches one link within
// the fetcher's limits (safe-fetch.ts).
export const eventSubscriptions = onRequest(
  httpOptions({ name: 'eventSubscriptions', timeoutSeconds: 120, secrets: [OPEN_METEO_API_KEY] }),
  browserApi({
    name: 'eventSubscriptions',
    method: 'POST',
    appCheckMode: 'standard',
    perAddressPerMinute: 20,
    costFeature: 'eventSubscriptions',
    fallbackMessage: 'Linked calendars are unavailable',
    handler: async req => ({
      body: await handleSubscriptionRequest(
        { ...deps, auth: getAuth(), enabled: () => EVENTS_SUBSCRIPTIONS_ENABLED.value() },
        req,
      ),
    }),
  }),
)

/**
 * The third of Cloud Scheduler's three free jobs. Every 30 minutes it refreshes the
 * links that are due (every 6 hours each, longer while one fails), oldest due first,
 * within REFRESH_RUN_LIMITS; it logs an ERROR when links wait a whole refresh period too
 * long. Paused while the cost guard is engaged: no one is owed a refresh, and the links
 * stay due for later.
 */
export const eventSubscriptionsRefresh = onSchedule(
  scheduleOptions('every 30 minutes', { timeoutSeconds: 300, secrets: [OPEN_METEO_API_KEY] }),
  async () => {
    if (!EVENTS_SUBSCRIPTIONS_ENABLED.value()) return
    if (await costGuard.engaged()) {
      logger.warn('linked calendar refresh paused by the cost guard')
      return
    }
    await runSubscriptionRefresh(deps)
  },
)
