// Linked calendar Cloud Functions (docs/integrations/EVENTS.md, phase 2): the endpoint
// that adds, refreshes and removes a link, and the scheduled refresh.

import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { CallerShare } from '../forecast/caller-share'
import {
  OPEN_METEO_API_KEY,
  UPSTREAM_SHARE_PER_CALLER,
  placeSearchLimits,
} from '../forecast/config'
import { PlaceSearchCache } from '../forecast/place-search'
import { UpstreamBudget } from '../forecast/upstream-budget'
import { browserApi, costGuard } from '../shared/browser-api'
import { db } from '../shared/firebase'
import { httpOptions, scheduleOptions } from '../shared/options'
import { EVENTS_SUBSCRIPTIONS_ENABLED } from './config'
import { handleSubscriptionRequest } from './endpoint'
import { fetchCalendar } from './safe-fetch'
import { type SubscriptionDeps, runSubscriptionRefresh } from './subscriptions'

/** The plan's key, or null while the secret holds the `unset` placeholder. */
function planKey(): string | null {
  const key = OPEN_METEO_API_KEY.value().trim()
  return key && key !== 'unset' ? key : null
}

// LOCATION text is looked up with the commercial place search, inside place search's own
// global budget, and each account has a share of it like a caller of the proxy (REVIEW4
// H1), so linked calendars cannot starve anyone's searches. Without the key, events with
// only LOCATION text use the person's place, as an import does when search fails.
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
const placeShare = new CallerShare({
  db,
  scope: 'places',
  perHour: () => UPSTREAM_SHARE_PER_CALLER.value(),
})

const deps: SubscriptionDeps = {
  db,
  fetchCalendar: (url, validators) => fetchCalendar(url, validators),
  searchPlace: async (uid, query) =>
    (
      await places.search(
        { name: query, count: 5 },
        { mayFetch: () => placeShare.take([{ key: `uid:${uid}`, weight: 1 }]) },
      )
    ).results,
}

// Signed-in accounts only; App Check, the per-address and per-account limits and the
// cost guard sit in front of every call. Each add or refresh fetches one link within
// the fetcher's limits (safe-fetch.ts).
export const eventSubscriptions = onRequest(
  httpOptions({ name: 'eventSubscriptions', timeoutSeconds: 60, secrets: [OPEN_METEO_API_KEY] }),
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
 * links that are due (every 6 hours each, longer while one fails), at most
 * REFRESH_RUN_LIMITS.maxLinks a run. Paused while the cost guard is engaged: no one is
 * owed a refresh, and the links stay due for later.
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
