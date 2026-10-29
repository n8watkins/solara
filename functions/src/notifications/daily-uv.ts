// The daily UV push for Free accounts ("Protect from 10:10am to 3:40pm today"), sent by
// the scheduled `alerts` Function after Pro's alerts (functions.ts). The words and the
// timing rules are in packages/core/src/daily-uv.ts; Pro accounts get the personalised
// morning plan instead (alerts.ts).
//
// Enrolment: registering a notification device (devices.ts) creates
// `users/{uid}/alertSchedule/dailyUv` with `dueAt` now; removing the last device, or a
// run that finds none, deletes it. Each run reads only the schedules that are due
// (`dueAt <= now`, a collection group query), not every account, and moves `dueAt` on to
// the account's next check (`nextDailyUvCheck`: at most two a day), so an enrolled
// account costs about a dozen reads a day however often the job runs.
//
// At most once a local day: the push is claimed in `alertState/daily` under `basic`
// before it is sent, like the morning alert, and only a send that failed for certain on
// every device is tried again (ALERT_MAX_ATTEMPTS). Its forecasts come through the
// shared forecast cache within the server's side of the upstream budget and each
// account's own share of it (functions.ts), at most DAILY_UV_MAX_FORECASTS_PER_RUN new
// places a run, so Free accounts cannot spend the hour's paid calls.

import { type OpenMeteoResponse, daylightHours, localTime, quietHours } from '#core'
import {
  dailyUvDue,
  dailyUvMessage,
  dailyUvSendHour,
  nextDailyUvCheck,
  protectionWindow,
} from '#core/daily-uv'

import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { hasProEntitlement } from '../billing/entitlement'
import { loggableError } from '../shared/errors'
import {
  ALERT_STATE_COLLECTION,
  ALERT_STATE_DOC,
  type AlertMessaging,
  type AlertOutcome,
  type SentKind,
  alertDayHours,
  alertDevices,
  canSend,
  clockOf,
  deliver,
  deliveryKey,
  mapLimit,
  validLocation,
} from './alerts'
import { ALERT_SCHEDULE_COLLECTION, DAILY_UV_SCHEDULE_DOC } from './schedule'

export { ALERT_SCHEDULE_COLLECTION, DAILY_UV_SCHEDULE_DOC, dailyUvScheduleRef } from './schedule'

/** Most due schedules one run looks at. */
export const DAILY_UV_MAX_ACCOUNTS_PER_RUN = 1000
/** Most new forecast places one run looks up (each may cost an upstream call). */
export const DAILY_UV_MAX_FORECASTS_PER_RUN = 300
/** A push that could not go out for now (no forecast yet, a failed send) is retried after this. */
export const DAILY_UV_RETRY_MS = 15 * 60_000
/** After this local hour the day's push is not sent any more. */
const LATEST_HOUR = 21
export const DAILY_UV_CONCURRENCY = 10
/** The part of the job's run kept for the daily UV pushes (functions.ts). */
export const DAILY_UV_BUDGET_MS = 60_000

export type DailyUvOutcome = AlertOutcome | 'pro' | 'off' | 'low-day' | 'no-account' | 'rescheduled'

export interface DailyUvDependencies {
  db: Firestore
  messaging: AlertMessaging
  appUrl: string
  /** The forecast at an account's place, within the upstream budget and the account's share. */
  forecast: (place: { lat: number; lon: number }, uid: string) => Promise<OpenMeteoResponse>
  now?: () => number
  limits?: Partial<DailyUvLimits>
}

export interface DailyUvLimits {
  maxAccounts: number
  maxForecasts: number
  concurrency: number
  budgetMs: number
}

const DEFAULT_LIMITS: DailyUvLimits = {
  maxAccounts: DAILY_UV_MAX_ACCOUNTS_PER_RUN,
  maxForecasts: DAILY_UV_MAX_FORECASTS_PER_RUN,
  concurrency: DAILY_UV_CONCURRENCY,
  budgetMs: DAILY_UV_BUDGET_MS,
}

export interface DailyUvRunResult {
  checked: number
  outcomes: Partial<Record<DailyUvOutcome, number>>
  sent: number
  removedDevices: number
}

const DAY_MS = 24 * 60 * 60 * 1000

class DailyRun {
  readonly limits: DailyUvLimits
  readonly now: () => number
  readonly startedAt: number
  readonly outcomes: Partial<Record<DailyUvOutcome, number>> = {}
  readonly sent: Partial<Record<SentKind, number>> = {}
  removedDevices = 0
  forecastLookups = 0
  private readonly forecasts = new Map<string, Promise<OpenMeteoResponse | null>>()

  constructor(readonly deps: DailyUvDependencies) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
    this.startedAt = this.now()
  }

  count(outcome: DailyUvOutcome): void {
    this.outcomes[outcome] = (this.outcomes[outcome] ?? 0) + 1
  }

  outOfTime(): boolean {
    return this.now() - this.startedAt >= this.limits.budgetMs
  }

  /** The forecast for a place once per run; 'limit' past the run's cap, null when unavailable. */
  forecast(lat: number, lon: number, uid: string): Promise<OpenMeteoResponse | null> | 'limit' {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const known = this.forecasts.get(key)
    if (known) return known
    if (this.forecastLookups >= this.limits.maxForecasts) return 'limit'
    this.forecastLookups += 1
    const lookup = this.deps.forecast({ lat, lon }, uid).catch(error => {
      logger.warn('daily UV forecast unavailable', { error: loggableError(error) })
      return null
    })
    this.forecasts.set(key, lookup)
    return lookup
  }
}

/** One account whose daily UV check is due: send, or move its next check on. */
async function processSchedule(run: DailyRun, doc: QueryDocumentSnapshot): Promise<DailyUvOutcome> {
  const userRef = doc.ref.parent.parent
  if (!userRef) return 'no-account'
  const now = run.now()
  const next = (at: number) => doc.ref.update({ dueAt: new Date(Math.max(at, now + 60_000)) })

  const userSnapshot = await userRef.get()
  const user = userSnapshot.data()
  if (!userSnapshot.exists || !user || user.accountDeletionStartedAt) {
    await doc.ref.delete()
    return 'no-account'
  }
  if (!validLocation(user.location)) {
    await next(now + DAY_MS)
    return 'no-location'
  }
  const { lat, lon } = user.location
  const quiet = quietHours(user.quietHours)
  const sendHour = dailyUvSendHour(user.notificationHour, quiet)

  let timeZone = typeof user.location.timezone === 'string' ? user.location.timezone : ''
  let forecast: OpenMeteoResponse | null | undefined
  if (!localTime(new Date(now), timeZone)) {
    // Places saved before they carried a time zone: the forecast knows it.
    const lookup = run.forecast(lat, lon, userRef.id)
    if (lookup === 'limit') {
      await next(now + DAILY_UV_RETRY_MS)
      return 'forecast-limit'
    }
    forecast = await lookup
    timeZone = forecast?.timezone ?? ''
  }
  const local = localTime(new Date(now), timeZone)
  if (!local) {
    await next(now + (forecast === null ? DAILY_UV_RETRY_MS : DAY_MS))
    return forecast === null ? 'no-forecast' : 'no-location'
  }
  const doneToday = () =>
    next(nextDailyUvCheck({ nowMs: now, timeZone, sendHour, doneToday: true }))

  // Pro gets the morning plan instead; a lapsed Pro gets this again from the next day.
  if (hasProEntitlement(user, now)) {
    await doneToday()
    return 'pro'
  }
  if (user.dailyUv === false) {
    await doneToday()
    return 'off'
  }
  if (local.hour < sendHour) {
    await next(nextDailyUvCheck({ nowMs: now, timeZone, sendHour, doneToday: false }))
    return 'not-due'
  }
  if (local.hour >= LATEST_HOUR) {
    await doneToday()
    return 'not-due'
  }

  const stateRef = userRef.collection(ALERT_STATE_COLLECTION).doc(ALERT_STATE_DOC)
  if (!canSend((await stateRef.get()).data(), 'basic', local.date)) {
    await doneToday()
    return 'already-sent'
  }
  const devices = await alertDevices(run.deps.db, userRef)
  if (devices.length === 0) {
    // Enrolled again when a device is registered.
    await doc.ref.delete()
    return 'no-devices'
  }

  if (forecast === undefined) {
    const lookup = run.forecast(lat, lon, userRef.id)
    if (lookup === 'limit') {
      await next(now + DAILY_UV_RETRY_MS)
      return 'forecast-limit'
    }
    forecast = await lookup
  }
  if (!forecast) {
    await next(now + DAILY_UV_RETRY_MS)
    return 'no-forecast'
  }
  const hours = alertDayHours(forecast, local.date).map(({ hour, uv }) => ({ hour, uv }))
  const window = protectionWindow(hours, daylightHours({ lat, lon }, local.date, timeZone))
  if (!window || local.hour >= window.to) {
    await doneToday()
    return 'low-day'
  }
  if (!dailyUvDue(local.hour, sendHour, window, quiet)) {
    // Quiet hours that start after the send hour: look again once they end.
    await next(now + DAILY_UV_RETRY_MS)
    return 'not-due'
  }

  const alert = dailyUvMessage({
    window,
    city: typeof user.location.city === 'string' ? user.location.city : '',
    localHour: local.hour,
    clock: clockOf(user),
  })
  const outcome = await deliver(
    run,
    stateRef,
    userRef.id,
    devices,
    { kind: 'basic', field: 'basic', day: local.date, key: deliveryKey('basic', local.date) },
    alert,
  )
  // Failed for certain on every device: canSend lets a later run try again today.
  if (outcome === 'failed') await next(now + DAILY_UV_RETRY_MS)
  else await doneToday()
  return outcome
}

/** The daily UV pushes due in this run, within its limits. */
export async function runDailyUv(deps: DailyUvDependencies): Promise<DailyUvRunResult> {
  const run = new DailyRun(deps)
  const due = await deps.db
    .collectionGroup(ALERT_SCHEDULE_COLLECTION)
    .where('dueAt', '<=', new Date(run.startedAt))
    .orderBy('dueAt')
    .limit(run.limits.maxAccounts)
    .get()
  let checked = 0
  await mapLimit(due.docs, run.limits.concurrency, async doc => {
    if (doc.id !== DAILY_UV_SCHEDULE_DOC) return
    // Left for the next run, which starts with the oldest due.
    if (run.outOfTime()) {
      run.count('out-of-time')
      return
    }
    checked += 1
    try {
      run.count(await processSchedule(run, doc))
    } catch (error) {
      run.count('error')
      logger.error('daily UV push for an account failed', { error: loggableError(error) })
    }
  })
  if (due.docs.length >= run.limits.maxAccounts) {
    logger.warn('daily UV run reached its account limit; the next run carries on', {
      maxAccounts: run.limits.maxAccounts,
    })
  }
  if (run.forecastLookups >= run.limits.maxForecasts) {
    logger.warn('daily UV run reached its forecast lookup limit', {
      maxForecasts: run.limits.maxForecasts,
    })
  }
  const result = {
    checked,
    outcomes: run.outcomes,
    sent: run.sent.basic ?? 0,
    removedDevices: run.removedDevices,
  }
  logger.info('daily UV run completed', result)
  return result
}
