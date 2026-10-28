// Pro alerts: the morning alert and the UV alert, sent by the scheduled `alerts`
// Function every 15 minutes for every time zone (decision D6).
//
// Each run walks the Pro accounts (`tier == 'paid'`) in pages and, for each one:
//
// 1. checks the entitlement behind the tier (billing/entitlement.ts), so only an active
//    subscription, a trial or a past_due grace period gets anything;
// 2. decides from the stored preferences alone whether an alert can be due now in the
//    account's time zone (packages/core/src/alerts.ts), so an account that is not due
//    costs no further reads;
// 3. reads its alert state (`users/{uid}/alertState/daily`) and its devices, then the
//    day's forecast from the shared forecast cache (forecast/proxy.ts);
// 4. claims the alert in a transaction, sends it to every device of the account, and
//    records the outcome.
//
// At most once: an alert is claimed for its local day before it is sent, so a crash, a
// retry or two overlapping runs never send it twice. A claim whose outcome is unknown
// (a crash after sending, a network error) is never retried; only a send that failed
// for certain on every device is retried, at most ALERT_MAX_ATTEMPTS times. Each
// account gets at most one alert per run, so a morning and a UV alert that are due
// together go out one run apart.
//
// Bounded: at most ALERTS_MAX_USERS_PER_RUN accounts and ALERTS_MAX_FORECASTS_PER_RUN
// forecast lookups per run, ALERTS_CONCURRENCY at a time, within a time budget. A run
// that stops early saves its place (`alertDispatch/state`), and the next run carries on
// from there. Tokens FCM reports as invalid are removed with their device.

import {
  type AlertKind,
  type AlertMessage,
  type OpenMeteoResponse,
  hourlyRows,
  inQuietHours,
  isPlannableHour,
  localTime,
  morningAlertDue,
  morningAlertMessage,
  planUvAlert,
  quietHours,
  uvAlertDue,
  uvAlertMessage,
  uvAlertThreshold,
} from '#core'
import { createHash, randomUUID } from 'node:crypto'

import {
  type DocumentData,
  type DocumentReference,
  FieldPath,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import type { BatchResponse, Message } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions/logger'

import { hasProEntitlement } from '../billing/entitlement'
import { loggableError } from '../shared/errors'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'
import { MAX_NOTIFICATION_DEVICES, tokenOwnerId } from './devices'

export const ALERTS_PAGE_SIZE = 100
export const ALERTS_MAX_USERS_PER_RUN = 2000
export const ALERTS_MAX_FORECASTS_PER_RUN = 400
export const ALERTS_CONCURRENCY = 10
/** A run stops starting new accounts after this long (the Function's timeout is 300 s). */
export const ALERTS_RUN_BUDGET_MS = 240_000
/** Sends that failed for certain on every device are retried this many times a day. */
export const ALERT_MAX_ATTEMPTS = 3

export const ALERT_STATE_COLLECTION = 'alertState'
export const ALERT_STATE_DOC = 'daily'
export const ALERT_DISPATCH_COLLECTION = 'alertDispatch'
export const ALERT_DISPATCH_DOC = 'state'

/** FCM errors that mean the token will never work again: its device is removed. */
const DEAD_TOKEN_CODES: ReadonlySet<unknown> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

/** FCM errors that mean nothing was delivered, so a later run may try again. */
const DEFINITE_FAILURE_CODES: ReadonlySet<unknown> = new Set([
  ...DEAD_TOKEN_CODES,
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/invalid-recipient',
  'messaging/message-rate-exceeded',
  'messaging/mismatched-credential',
  'messaging/payload-size-limit-exceeded',
])

/** The part of the Admin SDK's Messaging the alerts use. */
export interface AlertMessaging {
  sendEach(messages: Message[]): Promise<BatchResponse>
}

export interface AlertsDependencies {
  db: Firestore
  messaging: AlertMessaging
  /** The forecast for a place, from the shared forecast cache. */
  forecast: (place: { lat: number; lon: number }) => Promise<OpenMeteoResponse>
  /** The app's address, opened by a tap on the alert. */
  appUrl: string
  now?: () => number
  limits?: Partial<AlertLimits>
}

export interface AlertLimits {
  pageSize: number
  maxUsers: number
  maxForecasts: number
  concurrency: number
  budgetMs: number
}

const DEFAULT_LIMITS: AlertLimits = {
  pageSize: ALERTS_PAGE_SIZE,
  maxUsers: ALERTS_MAX_USERS_PER_RUN,
  maxForecasts: ALERTS_MAX_FORECASTS_PER_RUN,
  concurrency: ALERTS_CONCURRENCY,
  budgetMs: ALERTS_RUN_BUDGET_MS,
}

/** What happened for one account in one run. */
export type AlertOutcome =
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'not-entitled'
  | 'no-location'
  | 'not-due'
  | 'already-sent'
  | 'no-devices'
  | 'no-forecast'
  | 'forecast-limit'
  | 'claim-lost'
  | 'error'

export interface AlertsRunResult {
  scanned: number
  completed: boolean
  outcomes: Partial<Record<AlertOutcome, number>>
  sent: Partial<Record<AlertKind, number>>
  removedDevices: number
}

interface KindState {
  day?: unknown
  status?: unknown
  attempts?: unknown
}

/** Whether an alert of this kind may still be sent on `day`, given the stored state. */
export function canSend(state: DocumentData | undefined, kind: AlertKind, day: string): boolean {
  const current = state?.[kind] as KindState | undefined
  if (current?.day !== day) return true
  const attempts = typeof current.attempts === 'number' ? current.attempts : 0
  return current.status === 'failed' && attempts < ALERT_MAX_ATTEMPTS
}

/** The per-account value the service worker uses to show one delivery only once. */
export function deliveryScope(uid: string): string {
  return createHash('sha256').update(`solara-notification:${uid}`).digest('base64url').slice(0, 22)
}

/** The delivery key of an alert: one per kind and local day. */
export function deliveryKey(kind: AlertKind, day: string): string {
  return `${kind}-v1:${day}`
}

function validLocation(location: unknown): location is {
  lat: number
  lon: number
  city?: unknown
  timezone?: unknown
} {
  const place = location as { lat?: unknown; lon?: unknown } | null | undefined
  return (
    typeof place?.lat === 'number' &&
    Number.isFinite(place.lat) &&
    Math.abs(place.lat) <= 90 &&
    typeof place.lon === 'number' &&
    Number.isFinite(place.lon) &&
    Math.abs(place.lon) <= 180
  )
}

interface Device {
  ref: DocumentReference
  token: string
}

class Run {
  readonly limits: AlertLimits
  readonly now: () => number
  readonly startedAt: number
  readonly outcomes: Partial<Record<AlertOutcome, number>> = {}
  readonly sent: Partial<Record<AlertKind, number>> = {}
  removedDevices = 0
  forecastLookups = 0
  private readonly forecasts = new Map<string, Promise<OpenMeteoResponse | null>>()

  constructor(readonly deps: AlertsDependencies) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
    this.startedAt = this.now()
  }

  count(outcome: AlertOutcome): void {
    this.outcomes[outcome] = (this.outcomes[outcome] ?? 0) + 1
  }

  outOfTime(): boolean {
    return this.now() - this.startedAt >= this.limits.budgetMs
  }

  /** The forecast for a place, once per run; null when it cannot be had or the cap is reached. */
  forecast(lat: number, lon: number): Promise<OpenMeteoResponse | null> | 'limit' {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const known = this.forecasts.get(key)
    if (known) return known
    if (this.forecastLookups >= this.limits.maxForecasts) return 'limit'
    this.forecastLookups += 1
    const lookup = this.deps.forecast({ lat, lon }).catch(error => {
      logger.warn('alert forecast unavailable', { error: loggableError(error) })
      return null
    })
    this.forecasts.set(key, lookup)
    return lookup
  }
}

/** The account's devices that may receive an alert: enabled, owned and fully registered. */
async function alertDevices(db: Firestore, userRef: DocumentReference): Promise<Device[]> {
  const snapshot = await userRef
    .collection('notificationDevices')
    .where('enabled', '==', true)
    .limit(MAX_NOTIFICATION_DEVICES)
    .get()
  const candidates = snapshot.docs.filter(doc => {
    const data = doc.data()
    return typeof data.token === 'string' && data.token && !data.registrationMigrationId
  })
  if (candidates.length === 0) return []
  const owners = await db.getAll(
    ...candidates.map(doc =>
      db.collection('notificationTokenOwners').doc(tokenOwnerId(doc.data().token as string)),
    ),
  )
  return candidates.flatMap((doc, index) => {
    const owner = owners[index]?.data()
    return owner?.uid === userRef.id && owner.deviceId === doc.id
      ? [{ ref: doc.ref, token: doc.data().token as string }]
      : []
  })
}

/** Removes a device whose token FCM rejected for good, unless it was registered again meanwhile. */
async function removeDeadDevice(db: Firestore, device: Device): Promise<boolean> {
  const ownerRef = db.collection('notificationTokenOwners').doc(tokenOwnerId(device.token))
  return db.runTransaction(async transaction => {
    const [deviceSnapshot, ownerSnapshot] = await Promise.all([
      transaction.get(device.ref),
      transaction.get(ownerRef),
    ])
    if (!deviceSnapshot.exists || deviceSnapshot.data()?.token !== device.token) return false
    transaction.delete(device.ref)
    const owner = ownerSnapshot.data()
    const uid = device.ref.parent.parent?.id
    if (owner?.uid === uid && owner?.deviceId === device.ref.id) transaction.delete(ownerRef)
    return true
  })
}

/** A day's daytime hours with a known UV, in the place's local time. */
export function alertDayHours(
  forecast: OpenMeteoResponse,
  date: string,
): { hour: number; uv: number }[] {
  return hourlyRows(forecast)
    .filter(row => row.date === date && isPlannableHour(row))
    .map(row => ({ hour: row.hour, uv: row.uv as number }))
}

function clockOf(user: DocumentData): '12h' | '24h' {
  return user.clockFormat === '24h' ? '24h' : '12h'
}

/**
 * Claims an alert for its day. Fails (returns null) when the state shows it was sent,
 * is being sent, or ended in an unknown state since `canSend` was checked.
 */
async function claim(
  db: Firestore,
  stateRef: DocumentReference,
  kind: AlertKind,
  day: string,
  now: number,
): Promise<{ attemptId: string } | null> {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef)
    const state = snapshot.data()
    if (!canSend(state, kind, day)) return null
    const prior = state?.[kind] as KindState | undefined
    const attempts =
      prior?.day === day && typeof prior.attempts === 'number' ? prior.attempts + 1 : 1
    const attemptId = randomUUID()
    transaction.set(
      stateRef,
      {
        [kind]: { day, status: 'claimed', attemptId, attempts, claimedAt: new Date(now) },
        expireAt: expiresAfter(RETENTION_DAYS.alertState, new Date(now)),
      },
      { mergeFields: [kind, 'expireAt'] },
    )
    return { attemptId }
  })
}

async function finish(
  db: Firestore,
  stateRef: DocumentReference,
  kind: AlertKind,
  attemptId: string,
  outcome: { status: 'delivered' | 'failed' | 'unknown'; delivered: number; error?: string },
  now: number,
): Promise<void> {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef)
    const current = snapshot.data()?.[kind] as (KindState & { attemptId?: unknown }) | undefined
    if (current?.attemptId !== attemptId) return
    transaction.set(
      stateRef,
      {
        [kind]: {
          ...current,
          status: outcome.status,
          devices: outcome.delivered,
          finishedAt: new Date(now),
          ...(outcome.error ? { error: outcome.error.slice(0, 200) } : {}),
        },
      },
      { mergeFields: [kind] },
    )
  })
}

function messageFor(
  kind: AlertKind,
  day: string,
  uid: string,
  token: string,
  alert: AlertMessage,
  appUrl: string,
): Message {
  const key = deliveryKey(kind, day)
  // Data only: the push worker (scripts/sw/firebase-messaging-sw.ts) shows it once per
  // account and key, so a resent message never shows twice on one device.
  return {
    token,
    data: {
      title: alert.title,
      body: alert.body,
      deliveryKey: key,
      deliveryScope: deliveryScope(uid),
      link: `${appUrl}/app/`,
    },
    webpush: { headers: { Urgency: kind === 'uv' ? 'high' : 'normal', TTL: '3600' } },
    android: { collapseKey: key, ttl: 3_600_000 },
    apns: { headers: { 'apns-collapse-id': key } },
  }
}

/** Sends one alert to every device and records the outcome. */
async function deliver(
  run: Run,
  stateRef: DocumentReference,
  uid: string,
  devices: Device[],
  kind: AlertKind,
  day: string,
  alert: AlertMessage,
): Promise<AlertOutcome> {
  const { db, messaging, appUrl } = run.deps
  const claimed = await claim(db, stateRef, kind, day, run.now())
  if (!claimed) return 'claim-lost'

  let response: BatchResponse
  try {
    response = await messaging.sendEach(
      devices.map(device => messageFor(kind, day, uid, device.token, alert, appUrl)),
    )
  } catch (error) {
    // Some messages may have gone out: the alert is not tried again today.
    logger.error('alert delivery outcome unknown', { kind, error: loggableError(error) })
    await finish(
      db,
      stateRef,
      kind,
      claimed.attemptId,
      { status: 'unknown', delivered: 0, error: String((error as Error)?.message ?? error) },
      run.now(),
    )
    return 'unknown'
  }

  const codes: unknown[] = []
  await Promise.all(
    response.responses.map(async (result, index) => {
      if (result.success) return
      const code = result.error?.code
      codes.push(code)
      const device = devices[index]
      if (device && DEAD_TOKEN_CODES.has(code)) {
        try {
          if (await removeDeadDevice(db, device)) run.removedDevices += 1
        } catch (error) {
          logger.warn('a dead notification device could not be removed', {
            error: loggableError(error),
          })
        }
      }
    }),
  )
  const status =
    response.successCount > 0
      ? 'delivered'
      : codes.every(code => DEFINITE_FAILURE_CODES.has(code))
        ? 'failed'
        : 'unknown'
  await finish(
    db,
    stateRef,
    kind,
    claimed.attemptId,
    {
      status,
      delivered: response.successCount,
      ...(codes.length ? { error: codes.map(String).join(',') } : {}),
    },
    run.now(),
  )
  if (status === 'delivered') {
    run.sent[kind] = (run.sent[kind] ?? 0) + 1
    return 'sent'
  }
  if (status === 'unknown') {
    logger.error('alert delivery outcome unknown', { kind, codes: codes.map(String) })
  }
  return status
}

/** Everything one account needs in one run. */
async function processAccount(run: Run, doc: QueryDocumentSnapshot): Promise<AlertOutcome> {
  const user = doc.data()
  const now = run.now()
  if (!hasProEntitlement(user, now)) return 'not-entitled'
  if (!validLocation(user.location)) return 'no-location'
  const { lat, lon } = user.location

  let timeZone = typeof user.location.timezone === 'string' ? user.location.timezone : ''
  let forecast: OpenMeteoResponse | null | undefined
  if (!localTime(new Date(now), timeZone)) {
    // Accounts saved before places carried a time zone: the forecast knows it.
    const lookup = run.forecast(lat, lon)
    if (lookup === 'limit') return 'forecast-limit'
    forecast = await lookup
    timeZone = forecast?.timezone ?? ''
  }
  const local = localTime(new Date(now), timeZone)
  if (!local) return forecast === null ? 'no-forecast' : 'no-location'

  const threshold = uvAlertThreshold(user.uvAlertThreshold)
  const quiet = quietHours(user.quietHours)
  const wants: AlertKind[] = []
  if (morningAlertDue(local.hour, user.notificationHour)) wants.push('morning')
  // The UV alert needs daylight; the exact hours come from the forecast below.
  if (threshold !== null && local.hour >= 5 && local.hour < 21 && !inQuietHours(local.hour, quiet))
    wants.push('uv')
  if (wants.length === 0) return 'not-due'

  const stateRef = doc.ref.collection(ALERT_STATE_COLLECTION).doc(ALERT_STATE_DOC)
  const state = (await stateRef.get()).data()
  const open = wants.filter(kind => canSend(state, kind, local.date))
  if (open.length === 0) return 'already-sent'

  const devices = await alertDevices(run.deps.db, doc.ref)
  if (devices.length === 0) return 'no-devices'

  if (forecast === undefined) {
    const lookup = run.forecast(lat, lon)
    if (lookup === 'limit') return 'forecast-limit'
    forecast = await lookup
  }
  const hourly = forecast ? alertDayHours(forecast, local.date) : []
  if (hourly.length === 0) return 'no-forecast'

  const city = typeof user.location.city === 'string' ? user.location.city : ''
  const clock = clockOf(user)
  if (open.includes('morning')) {
    const alert = morningAlertMessage({
      date: local.date,
      city,
      // The rest of the day: a window that has already started is offered from now.
      hourly: hourly.filter(h => h.hour >= Math.floor(local.hour)),
      activities: Array.isArray(user.activities) ? user.activities : [],
      skinType: user.skinType,
      clock,
    })
    return deliver(run, stateRef, doc.id, devices, 'morning', local.date, alert)
  }
  const plan = threshold === null ? null : planUvAlert(hourly, threshold)
  if (!plan || !uvAlertDue(plan, local.hour, quiet)) return 'not-due'
  const alert = uvAlertMessage({ plan, city, localHour: local.hour, clock })
  return deliver(run, stateRef, doc.id, devices, 'uv', local.date, alert)
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const lane = async () => {
    while (cursor < items.length) {
      const item = items[cursor++] as T
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

/** One scheduled run: every due alert, within the run's limits. */
export async function runAlerts(deps: AlertsDependencies): Promise<AlertsRunResult> {
  const run = new Run(deps)
  const { db } = deps
  const dispatchRef = db.collection(ALERT_DISPATCH_COLLECTION).doc(ALERT_DISPATCH_DOC)
  const stored = (await dispatchRef.get()).data()
  let cursor: string | null = typeof stored?.cursor === 'string' ? stored.cursor : null
  let scanned = 0
  let completed = false

  while (!run.outOfTime() && scanned < run.limits.maxUsers) {
    const size = Math.min(run.limits.pageSize, run.limits.maxUsers - scanned)
    let query = db
      .collection('users')
      .where('tier', '==', 'paid')
      .orderBy(FieldPath.documentId())
      .limit(size)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    await mapLimit(page.docs, run.limits.concurrency, async doc => {
      try {
        run.count(await processAccount(run, doc))
      } catch (error) {
        run.count('error')
        logger.error('alert for an account failed', { error: loggableError(error) })
      }
    })
    scanned += page.docs.length
    if (page.docs.length < size) {
      completed = true
      cursor = null
      break
    }
    cursor = page.docs.at(-1)?.id ?? null
  }

  await dispatchRef.set({ cursor, updatedAt: new Date(run.now()) })
  if (!completed) {
    logger.warn('alerts run stopped before the last account; the next run carries on', {
      scanned,
      maxUsers: run.limits.maxUsers,
    })
  }
  if (run.forecastLookups >= run.limits.maxForecasts) {
    logger.warn('alerts run reached its forecast lookup limit', {
      maxForecasts: run.limits.maxForecasts,
    })
  }
  const result = {
    scanned,
    completed,
    outcomes: run.outcomes,
    sent: run.sent,
    removedDevices: run.removedDevices,
  }
  logger.info('alerts run completed', result)
  return result
}
