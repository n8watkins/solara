// Notification Cloud Functions: registering and removing a device, the scheduled alerts
// for every time zone (Pro's morning, UV and event alerts, Free's daily UV push and the
// reapply reminders' backstop), and the reapply reminder's on-time delivery.

import { getAuth } from 'firebase-admin/auth'
import { getFunctions } from 'firebase-admin/functions'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions/logger'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onTaskDispatched } from 'firebase-functions/v2/tasks'

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
import { loggableError } from '../shared/errors'
import { db, serverTimestamp } from '../shared/firebase'
import {
  REGION,
  documentOptions,
  httpOptions,
  scheduleOptions,
  taskQueueOptions,
} from '../shared/options'
import { ALERTS_RUN_BUDGET_MS, runAlerts } from './alerts'
import { ALERTS_ENABLED, alertsServiceAccount, eventHeadsUpsEnabled } from './config'
import {
  registerNotificationDevice as registerDevice,
  removeNotificationDevice as removeDevice,
} from './devices'
import { DAILY_UV_BUDGET_MS, runDailyUv } from './daily-uv'
import {
  REAPPLY_REMINDER_DOC,
  REMINDER_COLLECTION,
  type ReminderTask,
  deliverReapplyReminder,
  reminderWritten,
  sweepReapplyReminders,
} from './reminders'

export const registerNotificationDevice = onRequest(
  httpOptions({ name: 'registerNotificationDevice', timeoutSeconds: 30 }),
  browserApi({
    name: 'registerNotificationDevice',
    method: 'POST',
    appCheckMode: 'standard',
    costFeature: 'notifications',
    fallbackMessage: 'Registration unavailable',
    handler: async req => ({
      body: await registerDevice({
        auth: getAuth(),
        db,
        req,
        serverTimestamp,
        // The daily UV push and the reapply reminder are free once the alerts are on.
        freeAccounts: ALERTS_ENABLED.value(),
      }),
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
  upstreamBudget: new UpstreamBudget({ db, limits: upstreamLimits, side: 'server' }),
})
const eventShare = new CallerShare({
  db,
  scope: 'events',
  perHour: () => UPSTREAM_SHARE_PER_CALLER.value(),
})
// The daily UV push's home forecasts: an account's own share, apart from its event
// heads-ups', so neither can use up the other's.
const dailyUvShare = new CallerShare({
  db,
  scope: 'daily-uv',
  perHour: () => UPSTREAM_SHARE_PER_CALLER.value(),
})

/**
 * The second of Cloud Scheduler's three free jobs (`maintenance` is the first). Every
 * 15 minutes, so every time zone, including the half- and quarter-hour ones, gets its
 * morning alert within its hour (decision D6). Each run: the reapply reminders whose
 * task did not run (reminders.ts), Pro's alerts (alerts.ts), then Free's daily UV
 * pushes that are due (daily-uv.ts).
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
    const messaging = getMessaging()
    const startedAt = Date.now()
    // Reminders whose on-time task did not run come first: they are already late, and
    // need no forecast. Each part fails on its own, so one cannot stop the others.
    await sweepReapplyReminders({ db, messaging, appUrl: appOrigin() }, { budgetMs: 20_000 }).catch(
      error => logger.error('reapply reminder sweep failed', { error: loggableError(error) }),
    )
    if (!commercialProvider()) {
      // Forecasts for alerts come from the commercial plan (decision D5).
      logger.error('alerts need the Open-Meteo commercial key (OPEN_METEO_API_KEY)')
      return
    }
    await runAlerts({
      db,
      messaging,
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
      // Pro's alerts first, leaving the end of the run to the daily UV pushes.
      limits: { budgetMs: ALERTS_RUN_BUDGET_MS - DAILY_UV_BUDGET_MS - (Date.now() - startedAt) },
    })
    await runDailyUv({
      db,
      messaging,
      // Free accounts' places are anyone's choice, so like event places they count against
      // the server's side of the upstream budget and each account's own share of it.
      forecast: (place, uid) =>
        eventForecasts.get(place, {
          mayFetch: () => dailyUvShare.take([{ key: `uid:${uid}`, weight: 1 }]),
        }),
      appUrl: appOrigin(),
      limits: { budgetMs: Math.max(10_000, ALERTS_RUN_BUDGET_MS - (Date.now() - startedAt)) },
    }).catch(error => logger.error('daily UV run failed', { error: loggableError(error) }))
  },
)

/** The reapply reminders' delivery queue (Cloud Tasks), named after its function. */
const REAPPLY_TASK_FUNCTION = 'reapplyReminderTask'

/**
 * A reapply reminder record was written by the browser (or the server's claim and
 * delete): a new schedule is counted against the account's daily cap and its delivery is
 * enqueued for its time (reminders.ts). Runs as the default identity, which may enqueue
 * tasks; a missed event is caught by the alerts job's sweep.
 */
export const reapplyReminderScheduled = onDocumentWritten(
  {
    ...documentOptions({ timeoutSeconds: 30 }),
    document: `users/{uid}/${REMINDER_COLLECTION}/${REAPPLY_REMINDER_DOC}`,
  },
  async event => {
    const uid = event.params.uid
    const outcome = await reminderWritten({
      db,
      uid,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
      enabled: ALERTS_ENABLED.value(),
      enqueue: async (task, at) => {
        await getFunctions()
          .taskQueue<ReminderTask>(`locations/${REGION}/functions/${REAPPLY_TASK_FUNCTION}`)
          .enqueue(task, { scheduleTime: at, dispatchDeadlineSeconds: 60 })
      },
    })
    if (outcome === 'scheduled' || outcome === 'capped' || outcome === 'invalid') {
      logger.info('reapply reminder written', { outcome })
    }
  },
)

/** Delivers one reapply reminder at its time, at most once (reminders.ts). */
export const reapplyReminderTask = onTaskDispatched<ReminderTask>(
  {
    ...taskQueueOptions({ timeoutSeconds: 60 }),
    ...(alertsServiceAccount() ? { serviceAccount: alertsServiceAccount() } : {}),
  },
  async request => {
    if (!ALERTS_ENABLED.value()) return
    if (await costGuard.pinnedByOwner()) {
      logger.warn('reapply reminder paused by the owner (cost guard override)')
      return
    }
    const { uid, id } = request.data ?? ({} as Partial<ReminderTask>)
    if (typeof uid !== 'string' || typeof id !== 'string') return
    const outcome = await deliverReapplyReminder(
      { db, messaging: getMessaging(), appUrl: appOrigin() },
      uid,
      id,
    )
    logger.info('reapply reminder task', { outcome })
  },
)
