// Notification Cloud Functions: registering and removing a device, and the scheduled
// Pro alerts (morning and UV) for every time zone.

import { getAuth } from 'firebase-admin/auth'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions/logger'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { OPEN_METEO_API_KEY, commercialProvider } from '../forecast/config'
import { ForecastCache } from '../forecast/proxy'
import { appOrigin, browserApi, costGuard } from '../shared/browser-api'
import { db, serverTimestamp } from '../shared/firebase'
import { httpOptions, scheduleOptions } from '../shared/options'
import { runAlerts } from './alerts'
import { ALERTS_ENABLED, alertsServiceAccount } from './config'
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
// upstream call an hour across the app and the alerts.
const forecasts = new ForecastCache({
  db,
  provider: () => commercialProvider(),
  upstreamAllowed: async () => !(await costGuard.engaged()),
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
    // Alerts are a traffic-driven cost: the cost guard pauses them like the other paths.
    if (await costGuard.engaged()) {
      logger.warn('alerts paused by the cost guard')
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
      appUrl: appOrigin(),
    })
  },
)
