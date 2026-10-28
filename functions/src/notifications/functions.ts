// Notification Cloud Functions: registering and removing a device, and the scheduled
// Pro alerts (morning and UV) for every time zone.

import { getAuth } from 'firebase-admin/auth'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { CallerShare } from '../forecast/caller-share'
import {
  OPEN_METEO_API_KEY,
  UPSTREAM_SHARE_PER_CALLER,
  commercialProvider,
  upstreamLimits,
} from '../forecast/config'
import { ForecastCache } from '../forecast/proxy'
import { UpstreamBudget } from '../forecast/upstream-budget'
import { appOrigin, browserApi, costGuard } from '../shared/browser-api'
import { db, serverTimestamp } from '../shared/firebase'
import { httpOptions, scheduleOptions } from '../shared/options'
import { runAlerts } from './alerts'
import { ALERTS_ENABLED, alertsServiceAccount, eventHeadsUpsEnabled } from './config'
import {
  registerNotificationDevice as registerDevice,
  removeNotificationDevice as removeDevice,
} from './devices'

export const registerNotificationDevice = onRequest(
  httpOptions({ name: 'registerNotificationDevice', timeoutSeconds: 30 }),
  browserApi({
    name: 'registerNotificationDevice',
    method: 'POST',
    appCheckMode: 'standard',
    costFeature: 'notifications',
    fallbackMessage: 'Registration unavailable',
    handler: async req => ({
      body: await registerDevice({ auth: getAuth(), db, req, serverTimestamp }),
    }),
  }),
)

export const removeNotificationDevice = onRequest(
  httpOptions({ name: 'removeNotificationDevice', timeoutSeconds: 30 }),
  browserApi({
    name: 'removeNotificationDevice',
    method: 'DELETE',
    appCheckMode: 'standard',
    fallbackMessage: 'Removal unavailable',
    handler: async req => ({
      body: await removeDevice({ auth: getAuth(), db, req }),
    }),
  }),
)

// Shares forecastCache/{place} with the forecast proxy, so a place costs at most one
// upstream call an hour across the app and the alerts. Not cost-guarded: the alerts'
// lookups are bounded by the per-run caps (alerts.ts), not by anyone's traffic.
const forecasts = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  upstreamAllowed: async () => true,
})

// Event heads-ups look up forecasts at places people chose (imported, linked and Google
// Calendar events),
// so unlike the home forecasts above they count against the global upstream budget, and
// each account has a share of it like a caller of the proxy (REVIEW4 H1): no account's
// events can spend the hour's paid calls. The cache itself is the same forecastCache.
const eventForecasts = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  // Like the home forecasts, never paused by a budget-engaged guard (finding H2); the
  // upstream budget and the account's share bound these calls instead.
  upstreamAllowed: async () => true,
  upstreamBudget: new UpstreamBudget({ db, limits: upstreamLimits }),
})
const eventShare = new CallerShare({
  db,
  scope: 'events',
  perHour: () => UPSTREAM_SHARE_PER_CALLER.value(),
})

/**
 * The second of Cloud Scheduler's three free jobs (`maintenance` is the first). Every
 * 15 minutes, so every time zone, including the half- and quarter-hour ones, gets its
 * morning alert within its hour (decision D6).
 */
export const alerts = onSchedule(
  {
    ...scheduleOptions('every 15 minutes', {
      timeoutSeconds: 300,
      secrets: [OPEN_METEO_API_KEY],
    }),
    ...(alertsServiceAccount() ? { serviceAccount: alertsServiceAccount() } : {}),
  },
  async () => {
    if (!ALERTS_ENABLED.value()) return
    // A guard the budget engaged does not pause the alerts (finding H2): paying customers
    // keep them while a flood is turned away. Only the owner's pin stops them at once.
    if (await costGuard.pinnedByOwner()) {
      logger.warn('alerts paused by the owner (cost guard override)')
      return
    }
    if (!commercialProvider()) {
      // Forecasts for Pro come from the commercial plan (decision D5).
      logger.error('alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)')
      return
    }
    await runAlerts({
      db,
      messaging: getMessaging(),
      forecast: place => forecasts.get(place),
      // With either events switch on (REVIEW6 L1), for every stored event alike.
      ...(eventHeadsUpsEnabled()
        ? {
            eventForecast: (place: { lat: number; lon: number }, uid: string) =>
              eventForecasts.get(place, {
                mayFetch: () => eventShare.take([{ key: `uid:${uid}`, weight: 1 }]),
              }),
          }
        : {}),
      appUrl: appOrigin(),
    })
  },
)
