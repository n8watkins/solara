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
//
// Event heads-ups (docs/integrations/EVENTS.md, phase 2; with either events switch, see
// functions.ts): when no morning or UV alert goes out for an account in a run, every
// imported, linked and Google Calendar event whose heads-up can be due now is checked
// (packages/core/src/event-heads-up.ts): only events that count as an outdoor activity,
// each event once however many sources hold a copy, and at most one push per account
// every 3 hours, naming the soonest high-UV event and counting the others it stands for
// (REVIEW5 M3): those due now and those that could not get one of their own after it
// (REVIEW6 L2). A push is claimed in `users/{uid}/alertState/events` with the events it
// covers.
//
// Their forecasts come through the shared cache within the global upstream budget and
// the account's own share of it. The walk over the accounts only gathers the events;
// the forecasts are then shared out fairly (REVIEW6 M1): a run looks up at most
// ALERTS_MAX_EVENT_FORECASTS_PER_RUN event places, an account at most
// ALERTS_MAX_EVENT_FORECASTS_PER_ACCOUNT of them, soonest event first, and the run hands
// them out one per account per round, so accounts with many events at new places cannot
// spend everyone else's.

import {
  APP_FORECAST_DAYS,
  type AlertKind,
  type AlertMessage,
  type OpenMeteoResponse,
  type QuietHours,
  daylightHours,
  hourlyRows,
  inQuietHours,
  isPlannableHour,
  localTime,
  morningAlertDue,
  morningAlertMessage,
  parsePlanningPreferences,
  planningFor,
  planUvAlert,
  quietHours,
  uvAlertDue,
  uvAlertMessage,
  uvAlertThreshold,
} from '#core'
import {
  EVENT_HEADS_UP,
  IMPORTED_EVENT_LIMITS,
  type ImportedEvent,
  countsAsOutdoorActivity,
  eventHeadsUpDue,
  eventHeadsUpLaterPossible,
  eventHeadsUpMessage,
  eventHeadsUpThrottled,
  eventHeadsUpWindowEnd,
  eventHeadsUpWorthy,
  eventTitleIdentity,
  eventUV,
  parseImportedEvent,
  withoutDuplicates,
} from '#core/event-import'
import { ANDROID_ALERT_CHANNEL_ID, deliveryScope } from '#core/push'
import { createHash, randomUUID } from 'node:crypto'

import {
  type DocumentData,
  type DocumentReference,
  FieldPath,
  FieldValue,
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
/** Most event places one run looks up a forecast for (each may cost an upstream call). */
export const ALERTS_MAX_EVENT_FORECASTS_PER_RUN = 200
/**
 * Most event places one account's heads-up looks up per run, for its soonest events
 * (REVIEW6 M1; default, owner may change, 2026-10-28). Places already looked up in the
 * run cost nothing and do not count.
 */
export const ALERTS_MAX_EVENT_FORECASTS_PER_ACCOUNT = 10
/**
 * Most upcoming events read per account and run for heads-ups: every event an account
 * can hold (REVIEW5 M3), though a run reads only those whose heads-up can be due now
 * (usually the next 3 hours, `eventHeadsUpWindowEnd`).
 */
export const EVENT_HEADS_UP_EVENTS_PER_ACCOUNT = IMPORTED_EVENT_LIMITS.maxStored
/** Heads-ups an account keeps a record of; older ones are dropped from its state. */
const EVENT_STATE_MAX_ENTRIES = 50
export const ALERTS_CONCURRENCY = 10
/** A run starts nothing new after this long (the Function's timeout is 300 s). */
export const ALERTS_RUN_BUDGET_MS = 240_000
/**
 * The last part of the run's time kept for the event heads-ups, which run after the walk
 * over the accounts: the walk stops starting new pages this long before the budget ends.
 */
export const ALERTS_HEADS_UP_RESERVE_MS = 60_000
/** Sends that failed for certain on every device are retried this many times a day. */
export const ALERT_MAX_ATTEMPTS = 3

export const ALERT_STATE_COLLECTION = 'alertState'
export const ALERT_STATE_DOC = 'daily'
/** users/{uid}/alertState/{EVENT_ALERT_STATE_DOC}: one field per event's heads-up. */
export const EVENT_ALERT_STATE_DOC = 'events'
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
  /**
   * Event heads-ups (with either events switch, functions.ts): the forecast at an
   * event's place for an account, through the shared cache within the upstream budget
   * and the account's share. Absent: no heads-ups are sent.
   */
  eventForecast?: (place: { lat: number; lon: number }, uid: string) => Promise<OpenMeteoResponse>
  now?: () => number
  limits?: Partial<AlertLimits>
}

export interface AlertLimits {
  pageSize: number
  maxUsers: number
  maxForecasts: number
  maxEventForecasts: number
  maxEventForecastsPerAccount: number
  concurrency: number
  budgetMs: number
  headsUpReserveMs: number
}

const DEFAULT_LIMITS: AlertLimits = {
  pageSize: ALERTS_PAGE_SIZE,
  maxUsers: ALERTS_MAX_USERS_PER_RUN,
  maxForecasts: ALERTS_MAX_FORECASTS_PER_RUN,
  maxEventForecasts: ALERTS_MAX_EVENT_FORECASTS_PER_RUN,
  maxEventForecastsPerAccount: ALERTS_MAX_EVENT_FORECASTS_PER_ACCOUNT,
  concurrency: ALERTS_CONCURRENCY,
  budgetMs: ALERTS_RUN_BUDGET_MS,
  headsUpReserveMs: ALERTS_HEADS_UP_RESERVE_MS,
}

/**
 * What is sent: a morning or UV alert, the daily UV push (daily-uv.ts), an event
 * heads-up, or a sunscreen reapply reminder (reminders.ts).
 */
export type SentKind = AlertKind | 'event' | 'reapply'

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
  | 'out-of-time'
  | 'error'

export interface AlertsRunResult {
  scanned: number
  completed: boolean
  outcomes: Partial<Record<AlertOutcome, number>>
  sent: Partial<Record<SentKind, number>>
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
export { deliveryScope }

/** The delivery key of an alert: one per kind and local day. */
export function deliveryKey(kind: AlertKind, day: string): string {
  return `${kind}-v1:${day}`
}

export function validLocation(location: unknown): location is {
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

export interface Device {
  ref: DocumentReference
  token: string
  /** 'web', 'android' or 'ios', as registered (devices.ts); older devices have none (web). */
  platform: string
}

/** The run's key for a place's forecast. */
function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}

export class Run {
  readonly limits: AlertLimits
  readonly now: () => number
  readonly startedAt: number
  readonly outcomes: Partial<Record<AlertOutcome, number>> = {}
  readonly sent: Partial<Record<SentKind, number>> = {}
  removedDevices = 0
  forecastLookups = 0
  /** Event places planned for a lookup in this run (`planHeadsUpLookups`). */
  eventForecastLookups = 0
  private readonly forecasts = new Map<string, Promise<OpenMeteoResponse | null>>()
  private readonly eventForecasts = new Map<string, Promise<OpenMeteoResponse | null>>()
  private readonly plannedEventCells = new Set<string>()

  constructor(readonly deps: AlertsDependencies) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
    this.startedAt = this.now()
  }

  count(outcome: AlertOutcome): void {
    this.outcomes[outcome] = (this.outcomes[outcome] ?? 0) + 1
  }

  /** Whether the run may start nothing new. */
  outOfTime(): boolean {
    return this.now() - this.startedAt >= this.limits.budgetMs
  }

  /** Whether the walk over the accounts stops, leaving the rest of the time to the heads-ups. */
  walkOutOfTime(): boolean {
    return this.now() - this.startedAt >= this.limits.budgetMs - this.limits.headsUpReserveMs
  }

  /** The forecast for a place, once per run; null when it cannot be had or the cap is reached. */
  forecast(lat: number, lon: number): Promise<OpenMeteoResponse | null> | 'limit' {
    const key = cellKey(lat, lon)
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

  /** Whether an event's place is already looked up, or planned to be, in this run (free). */
  eventPlaceKnown(place: { lat: number; lon: number }): boolean {
    const key = cellKey(place.lat, place.lon)
    return this.plannedEventCells.has(key) || this.forecasts.has(key)
  }

  /** Plans a lookup of an event's place, unless the run's event forecast cap is reached. */
  planEventLookup(place: { lat: number; lon: number }): boolean {
    if (this.eventForecastLookups >= this.limits.maxEventForecasts) return false
    this.eventForecastLookups += 1
    this.plannedEventCells.add(cellKey(place.lat, place.lon))
    return true
  }

  /**
   * The forecast at an event's place for an account, once per run and place (planned by
   * `planHeadsUpLookups`, which keeps to the caps); null when it cannot be had.
   */
  eventForecast(lat: number, lon: number, uid: string): Promise<OpenMeteoResponse | null> | null {
    const lookupFor = this.deps.eventForecast
    if (!lookupFor) return null
    const key = cellKey(lat, lon)
    const known = this.eventForecasts.get(key) ?? this.forecasts.get(key)
    if (known) return known
    const lookup = lookupFor({ lat, lon }, uid).catch(error => {
      logger.warn('event forecast unavailable', { error: loggableError(error) })
      return null
    })
    this.eventForecasts.set(key, lookup)
    return lookup
  }
}

/** The account's devices that may receive an alert: enabled, owned and fully registered. */
export async function alertDevices(db: Firestore, userRef: DocumentReference): Promise<Device[]> {
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
      ? [
          {
            ref: doc.ref,
            token: doc.data().token as string,
            platform: typeof doc.data().platform === 'string' ? doc.data().platform : 'web',
          },
        ]
      : []
  })
}

/** Removes a device whose token FCM rejected for good, unless it was registered again meanwhile. */
export async function removeDeadDevice(db: Firestore, device: Device): Promise<boolean> {
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

/**
 * A day's daytime hours with a known UV, in the place's local time, with the clear-sky
 * UV (never below the forecast's) so the morning alert plans like the app.
 */
export function alertDayHours(
  forecast: OpenMeteoResponse,
  date: string,
): { hour: number; uv: number; clearSkyUV?: number }[] {
  return hourlyRows(forecast)
    .filter(row => row.date === date && isPlannableHour(row))
    .map(row => {
      const uv = row.uv as number
      return row.clearSkyUV === null
        ? { hour: row.hour, uv }
        : { hour: row.hour, uv, clearSkyUV: Math.max(row.clearSkyUV, uv) }
    })
}

export function clockOf(user: DocumentData): '12h' | '24h' {
  return user.clockFormat === '24h' ? '24h' : '12h'
}

/**
 * Claims an alert for its day. Fails (returns null) when the state shows it was sent,
 * is being sent, or ended in an unknown state since `canSend` was checked.
 */
async function claim(
  db: Firestore,
  stateRef: DocumentReference,
  kind: string,
  day: string,
  now: number,
): Promise<{ attemptId: string } | null> {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef)
    const state = snapshot.data()
    if (!canSend(state, kind as AlertKind, day)) return null
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

/** The fields of a per-item state beyond the newest `keep`, oldest first. */
function oldestEntries(state: DocumentData | undefined, keep: number): string[] {
  const entries = Object.entries(state ?? {})
    .filter(([field, value]) => field !== 'expireAt' && value && typeof value === 'object')
    .map(([field, value]) => {
      return { field, at: millis((value as EventEntry).claimedAt) ?? 0 }
    })
    .sort((a, b) => b.at - a.at)
  return entries.slice(Math.max(0, keep)).map(entry => entry.field)
}

async function finish(
  db: Firestore,
  stateRef: DocumentReference,
  kind: string,
  attemptId: string,
  outcome: { status: 'delivered' | 'failed' | 'unknown'; delivered: number; error?: string },
  now: number,
  covered: readonly string[] = [],
): Promise<void> {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef)
    const state = snapshot.data()
    const current = state?.[kind] as (KindState & { attemptId?: unknown }) | undefined
    if (current?.attemptId !== attemptId) return
    // Nothing reached the person: the events this push stood for may get their own.
    const released =
      outcome.status === 'failed'
        ? covered.filter(field => (state?.[field] as { by?: unknown } | undefined)?.by === kind)
        : []
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
        ...Object.fromEntries(released.map(field => [field, FieldValue.delete()])),
      },
      { mergeFields: [kind, ...released] },
    )
  })
}

/** What one delivery is: its kind, its state field and day, and its delivery key. */
export interface Delivery {
  kind: SentKind
  /** The field of the state document that records it. */
  field: string
  /** The value that marks it sent: a local day, or the event's key. */
  day: string
  key: string
}

export function messageFor(
  delivery: Delivery,
  uid: string,
  device: Pick<Device, 'token' | 'platform'>,
  alert: AlertMessage,
  appUrl: string,
): Message {
  const { kind, key } = delivery
  const data = {
    title: alert.title,
    body: alert.body,
    deliveryKey: key,
    deliveryScope: deliveryScope(uid),
    link: `${appUrl}/app/`,
  }
  if (device.platform === 'android') {
    // A native Android app: Android shows a notification message itself, even when the
    // app was swiped away or the phone is in battery saver, and high priority gets it
    // through Doze on time. The tag and collapse key replace a resent copy instead of
    // stacking it. The data stays for the app's tap handler.
    return {
      token: device.token,
      data,
      android: {
        collapseKey: key,
        ttl: 3_600_000,
        priority: 'high',
        notification: {
          title: alert.title,
          body: alert.body,
          channelId: ANDROID_ALERT_CHANNEL_ID,
          tag: key,
        },
      },
    }
  }
  // Data only: the push worker (scripts/sw/firebase-messaging-sw.ts) shows it once per
  // account and key, so a resent message never shows twice on one device.
  return {
    token: device.token,
    data,
    // The morning plan and the daily UV push can wait for a phone to wake; the rest are timely.
    webpush: {
      headers: { Urgency: kind === 'morning' || kind === 'basic' ? 'normal' : 'high', TTL: '3600' },
    },
    android: { collapseKey: key, ttl: 3_600_000 },
    apns: { headers: { 'apns-collapse-id': key } },
  }
}

/** The parts of a run that a delivery uses and counts in. */
export interface DeliveryRun {
  deps: Pick<AlertsDependencies, 'db' | 'messaging' | 'appUrl'>
  now: () => number
  sent: Partial<Record<SentKind, number>>
  removedDevices: number
}

/** How one send to an account's devices went. */
export interface SendResult {
  /** Delivered to at least one device, failed for certain on all, or not known. */
  status: 'delivered' | 'failed' | 'unknown'
  delivered: number
  error?: string
}

/**
 * Sends one message to every device of an account, removes the devices whose token FCM
 * rejected for good, and says how it went. An error from FCM itself means some messages
 * may have gone out: the outcome is unknown, and the caller does not try again.
 */
export async function sendToDevices(
  run: Pick<DeliveryRun, 'deps' | 'removedDevices'>,
  uid: string,
  devices: Device[],
  delivery: Delivery,
  alert: AlertMessage,
): Promise<SendResult> {
  const { db, messaging, appUrl } = run.deps
  let response: BatchResponse
  try {
    response = await messaging.sendEach(
      devices.map(device => messageFor(delivery, uid, device, alert, appUrl)),
    )
  } catch (error) {
    logger.error('alert delivery outcome unknown', {
      kind: delivery.kind,
      error: loggableError(error),
    })
    return { status: 'unknown', delivered: 0, error: String((error as Error)?.message ?? error) }
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
  if (status === 'unknown') {
    logger.error('alert delivery outcome unknown', {
      kind: delivery.kind,
      codes: codes.map(String),
    })
  }
  return {
    status,
    delivered: response.successCount,
    ...(codes.length ? { error: codes.map(String).join(',').slice(0, 200) } : {}),
  }
}

/**
 * Sends one alert to every device and records the outcome. `claimWith` replaces the
 * daily claim (event heads-ups claim with the events they cover); `covered` are those
 * events' fields, released again when the send failed for certain.
 */
export async function deliver(
  run: DeliveryRun,
  stateRef: DocumentReference,
  uid: string,
  devices: Device[],
  delivery: Delivery,
  alert: AlertMessage,
  claimWith?: () => Promise<{ attemptId: string } | null>,
  covered: readonly string[] = [],
): Promise<AlertOutcome> {
  const { db } = run.deps
  const { kind, field, day } = delivery
  const claimed = await (claimWith ?? (() => claim(db, stateRef, field, day, run.now())))()
  if (!claimed) return 'claim-lost'

  const sent = await sendToDevices(run, uid, devices, delivery, alert)
  await finish(
    db,
    stateRef,
    field,
    claimed.attemptId,
    {
      status: sent.status,
      delivered: sent.delivered,
      ...(sent.error ? { error: sent.error } : {}),
    },
    run.now(),
    covered,
  )
  if (sent.status === 'delivered') {
    run.sent[kind] = (run.sent[kind] ?? 0) + 1
    return 'sent'
  }
  return sent.status
}

/** The devices of an account, read once per run however many alerts look for them. */
function devicesOnce(run: Run, userRef: DocumentReference): () => Promise<Device[]> {
  let pending: Promise<Device[]> | null = null
  return () => (pending ??= alertDevices(run.deps.db, userRef))
}

/**
 * Everything one account needs in the walk over the accounts: its outcome, or its event
 * heads-up, which waits for the event forecasts shared out after the walk.
 */
async function processAccount(
  run: Run,
  doc: QueryDocumentSnapshot,
): Promise<AlertOutcome | HeadsUpJob> {
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

  const quiet = quietHours(user.quietHours)
  const devices = devicesOnce(run, doc.ref)
  const daily = await dailyAlert(run, doc, { forecast, local, timeZone, quiet, devices })
  // At most one alert per account and run: a heads-up only when nothing else went out.
  if (daily !== 'not-due' && daily !== 'already-sent') return daily
  const headsUp = await prepareHeadsUp(run, doc, { timeZone, quiet, devices, otherwise: daily })
  return headsUp ?? daily
}

/** The morning or UV alert, when one is due. */
async function dailyAlert(
  run: Run,
  doc: QueryDocumentSnapshot,
  {
    forecast: known,
    local,
    timeZone,
    quiet,
    devices: readDevices,
  }: {
    forecast: OpenMeteoResponse | null | undefined
    local: { date: string; hour: number }
    /** The place's IANA zone, for its sunrise and sunset. */
    timeZone: string
    quiet: QuietHours
    devices: () => Promise<Device[]>
  },
): Promise<AlertOutcome> {
  const user = doc.data()
  const { lat, lon } = user.location as { lat: number; lon: number }
  let forecast = known
  const threshold = uvAlertThreshold(user.uvAlertThreshold)
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

  const devices = await readDevices()
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
  const daily = (kind: AlertKind): Delivery => ({
    kind,
    field: kind,
    day: local.date,
    key: deliveryKey(kind, local.date),
  })
  if (open.includes('morning')) {
    // Read as the app reads them, and planned for whom the dashboard plans for: one
    // person, or a group's most sensitive member (packages/core/src/planning.ts).
    const planning = parsePlanningPreferences(user)
    const alert = morningAlertMessage({
      date: local.date,
      city,
      // The rest of the day: a window that has already started is offered from now.
      hourly: hourly.filter(h => h.hour >= Math.floor(local.hour)),
      activities: planning.activities,
      skinType: planningFor(planning).skinType,
      clock,
      // As in the app, no window before sunrise or after sunset, however low its UV.
      daylight: daylightHours({ lat, lon }, local.date, timeZone),
    })
    return deliver(run, stateRef, doc.id, devices, daily('morning'), alert)
  }
  const plan = threshold === null ? null : planUvAlert(hourly, threshold)
  if (!plan || !uvAlertDue(plan, local.hour, quiet)) return 'not-due'
  const alert = uvAlertMessage({ plan, city, localHour: local.hour, clock })
  return deliver(run, stateRef, doc.id, devices, daily('uv'), alert)
}

/** The delivery key of an event's heads-up: one per event (occurrence). */
export function eventDeliveryKey(eventKey: string): string {
  return `event-v1:${eventKey}`
}

/** What the events state records of each heads-up, beyond `claim`'s fields. */
interface EventEntry extends KindState {
  claimedAt?: { toMillis?: () => number } | Date
  /** A hash of the title as people read it (`eventTitleIdentity`), never the title. */
  same?: unknown
  startMs?: unknown
}

function millis(value: EventEntry['claimedAt']): number | null {
  if (value instanceof Date) return value.getTime()
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

/** A short hash of an event's title identity, so the state holds no event text. */
function titleHash(title: string): string {
  return createHash('sha256').update(eventTitleIdentity(title)).digest('base64url').slice(0, 16)
}

function eventEntries(state: DocumentData | undefined): [string, EventEntry][] {
  return Object.entries(state ?? {}).filter(
    (entry): entry is [string, EventEntry] =>
      entry[0] !== 'expireAt' && !!entry[1] && typeof entry[1] === 'object',
  )
}

/** When the account's last heads-up went out (or may have): a push not known to have failed. */
function lastHeadsUpAt(state: DocumentData | undefined): number | null {
  let last: number | null = null
  for (const [, entry] of eventEntries(state)) {
    if (entry.status === 'failed' || entry.status === 'covered') continue
    const at = millis(entry.claimedAt)
    if (at !== null && (last === null || at > last)) last = at
  }
  return last
}

/**
 * Whether the state already has a heads-up (sent, being sent, or covered by another)
 * for this event or a copy of it under another key: another source, or a calendar
 * linked again (REVIEW5 M3).
 */
function alreadyHeard(
  state: DocumentData | undefined,
  item: { key: string; title: string; startMs: number },
): boolean {
  const same = titleHash(item.title)
  return eventEntries(state).some(([field, entry]) => {
    if (field === item.key) return !canSend(state, field as AlertKind, field)
    return (
      entry.status !== 'failed' &&
      entry.same === same &&
      typeof entry.startMs === 'number' &&
      Math.abs(entry.startMs - item.startMs) <= EVENT_HEADS_UP.duplicateMinutes * 60_000
    )
  })
}

/**
 * Claims one heads-up for `primary` and marks the other due events it stands for as
 * covered, unless the account's state shows a heads-up in the last few hours or one for
 * the same event (two overlapping runs, or a copy). Null when the claim is lost.
 */
async function claimHeadsUp(
  db: Firestore,
  stateRef: DocumentReference,
  primary: HeadsUpCandidate,
  covered: readonly HeadsUpCandidate[],
  now: number,
): Promise<{ attemptId: string } | null> {
  return db.runTransaction(async transaction => {
    const state = (await transaction.get(stateRef)).data()
    if (eventHeadsUpThrottled(lastHeadsUpAt(state), now) || alreadyHeard(state, primary)) {
      return null
    }
    const prior = state?.[primary.key] as KindState | undefined
    const attempts =
      prior?.day === primary.key && typeof prior.attempts === 'number' ? prior.attempts + 1 : 1
    const attemptId = randomUUID()
    const claimedAt = new Date(now)
    const record = (item: HeadsUpCandidate) => ({
      same: titleHash(item.title),
      startMs: item.startMs,
    })
    const fields: Record<string, unknown> = {
      [primary.key]: {
        day: primary.key,
        status: 'claimed',
        attemptId,
        attempts,
        claimedAt,
        ...record(primary),
      },
    }
    for (const item of covered) {
      fields[item.key] = {
        day: item.key,
        status: 'covered',
        by: primary.key,
        claimedAt,
        ...record(item),
      }
    }
    // One field per event: the oldest entries beyond EVENT_STATE_MAX_ENTRIES are dropped.
    const written = Object.keys(fields)
    const dropped = oldestEntries(state, EVENT_STATE_MAX_ENTRIES - written.length).filter(
      field => !written.includes(field),
    )
    transaction.set(
      stateRef,
      {
        ...fields,
        expireAt: expiresAfter(RETENTION_DAYS.alertState, claimedAt),
        ...Object.fromEntries(dropped.map(field => [field, FieldValue.delete()])),
      },
      { mergeFields: [...written, 'expireAt', ...dropped] },
    )
    return { attemptId }
  })
}

/** An upcoming outdoor event a heads-up may name or stand for. */
interface HeadsUpCandidate extends ImportedEvent {
  startMs: number
  /** Whether its own heads-up is due now: only such an event is named by a push. */
  due: boolean
}

/** An account whose heads-up waits for the event forecasts shared out after the walk. */
interface HeadsUpJob {
  doc: QueryDocumentSnapshot
  /** The account's outcome when no heads-up goes out (what the daily alerts said). */
  otherwise: AlertOutcome
  now: number
  activities: ReturnType<typeof parsePlanningPreferences>['activities']
  stateRef: DocumentReference
  devices: Device[]
  /** Soonest first: every event due now, and those that could not get one of their own later. */
  candidates: HeadsUpCandidate[]
  /** How many candidates, soonest first, get a forecast in this run (`planHeadsUpLookups`). */
  looked: number
}

/**
 * The account's heads-up, when one can be due: the outdoor events it may name or stand
 * for, waiting for their forecasts. Null when none can be due (so the account's outcome
 * stays what the daily alerts said).
 */
async function prepareHeadsUp(
  run: Run,
  doc: QueryDocumentSnapshot,
  {
    timeZone,
    quiet,
    devices: readDevices,
    otherwise,
  }: {
    timeZone: string
    quiet: QuietHours
    devices: () => Promise<Device[]>
    otherwise: AlertOutcome
  },
): Promise<HeadsUpJob | AlertOutcome | null> {
  const user = doc.data()
  if (!run.deps.eventForecast || user.eventHeadsUp === false) return null
  const now = run.now()
  const local = localTime(new Date(now), timeZone)
  if (!local || inQuietHours(local.hour, quiet)) return null
  // Only events that count as one of the person's (outdoor) activities get one.
  const { activities } = parsePlanningPreferences(user)
  if (activities.length === 0) return null

  // The state first: an account that had a heads-up in the last few hours reads nothing more.
  const stateRef = doc.ref.collection(ALERT_STATE_COLLECTION).doc(EVENT_ALERT_STATE_DOC)
  const state = (await stateRef.get()).data()
  if (eventHeadsUpThrottled(lastHeadsUpAt(state), now)) return null

  const outdoorEvents = async (after: number, until: number) => {
    const snapshot = await doc.ref
      .collection('events')
      .where('start', '>', new Date(after).toISOString())
      .where('start', '<=', new Date(until).toISOString())
      .orderBy('start')
      .limit(EVENT_HEADS_UP_EVENTS_PER_ACCOUNT)
      .get()
    return snapshot.docs.flatMap(event => {
      const item = parseImportedEvent(event.data())
      if (!item || item.key !== event.id || !countsAsOutdoorActivity(item, activities)) return []
      return [{ ...item, startMs: Date.parse(item.start) }]
    })
  }
  const isDue = (item: { startMs: number }) =>
    eventHeadsUpDue({ startMs: item.startMs, nowMs: now, timeZone, quiet })

  // Every event whose heads-up can be due now, not just the soonest few.
  const windowEnd = eventHeadsUpWindowEnd(now, timeZone, quiet)
  const near = await outdoorEvents(now + EVENT_HEADS_UP.latestMinutes * 60_000, windowEnd)
  if (!withoutDuplicates(near).some(item => isDue(item) && !alreadyHeard(state, item))) return null

  // A push now holds back the next one for the gap, so it also stands for the later
  // events that could not get a heads-up of their own after it (REVIEW6 L2): a 10K at
  // 12:15 behind a 1K at noon, or an early start due only the evening before.
  const lookaheadEnd = now + EVENT_HEADS_UP.lookaheadHours * 3_600_000
  const far = windowEnd < lookaheadEnd ? await outdoorEvents(windowEnd, lookaheadEnd) : []
  const gapEnd = now + EVENT_HEADS_UP.minGapHours * 3_600_000
  const candidates = withoutDuplicates([...near, ...far]).flatMap(item => {
    if (alreadyHeard(state, item)) return []
    const due = isDue(item)
    if (
      !due &&
      eventHeadsUpLaterPossible({ startMs: item.startMs, fromMs: gapEnd, timeZone, quiet })
    ) {
      return []
    }
    return [{ ...item, due }]
  })
  if (!candidates.some(item => item.due)) return null

  const devices = await readDevices()
  if (devices.length === 0) return 'no-devices'
  return { doc, otherwise, now, activities, stateRef, devices, candidates, looked: 0 }
}

/**
 * Shares the run's event forecast lookups out among the accounts' heads-ups (REVIEW6 M1):
 * each account's events are looked at soonest first, up to
 * `maxEventForecastsPerAccount` new places each, and the run's `maxEventForecasts` are
 * handed out one per account per round (the account whose next event starts soonest
 * first), so a few accounts with many events at new places cannot spend the lookups
 * every other account's heads-up needs. A place already looked up in the run is free.
 */
export function planHeadsUpLookups(
  run: Pick<Run, 'limits' | 'eventPlaceKnown' | 'planEventLookup'>,
  jobs: readonly Pick<HeadsUpJob, 'candidates' | 'looked'>[],
): void {
  const charged = new Map<object, number>()
  // Past every free place: the next event that needs a lookup of its own, if any.
  const skipKnown = (job: Pick<HeadsUpJob, 'candidates' | 'looked'>) => {
    while (job.looked < job.candidates.length) {
      const next = job.candidates[job.looked] as HeadsUpCandidate
      if (!run.eventPlaceKnown(next)) return next
      job.looked += 1
    }
    return null
  }
  let active = jobs.filter(job => skipKnown(job) !== null)
  while (active.length > 0) {
    const nextStart = (job: (typeof active)[number]) =>
      (job.candidates[job.looked] as HeadsUpCandidate).startMs
    active.sort((a, b) => nextStart(a) - nextStart(b))
    active = active.filter(job => {
      // An earlier account of this round may have planned the same place.
      const next = skipKnown(job)
      if (!next) return false
      const used = charged.get(job) ?? 0
      if (used >= run.limits.maxEventForecastsPerAccount || !run.planEventLookup(next)) {
        return false
      }
      charged.set(job, used + 1)
      job.looked += 1
      return skipKnown(job) !== null
    })
  }
}

/**
 * The heads-up before the account's soonest high-UV outdoor event due now, from the
 * forecasts planned for it; null when none is due (so the account's outcome stays what
 * the daily alerts said).
 */
async function sendHeadsUp(run: Run, job: HeadsUpJob): Promise<AlertOutcome | null> {
  const { doc, now, activities, stateRef, devices } = job
  const user = doc.data()
  // The UV at each one, soonest first; the push names the soonest high one due now.
  const worthy: { item: HeadsUpCandidate; zone: string; peakUV: number; peakAt: number }[] = []
  for (const item of job.candidates.slice(0, job.looked)) {
    const lookup = run.eventForecast(item.lat, item.lon, doc.id)
    const forecast = lookup ? await lookup : null
    if (!forecast) continue
    const zone = forecast.timezone || item.timeZone
    const today = localTime(new Date(now), zone)?.date
    if (!today) continue
    const activity = activities.find(entry => entry.id === item.activityId)
    const uv = eventUV({
      start: item.startMs,
      end: Date.parse(item.end),
      timeZone: zone,
      hoursOn: date => {
        const hours = alertDayHours(forecast, date)
        return hours.length ? hours : undefined
      },
      planDays: APP_FORECAST_DAYS,
      today,
      activity: activity
        ? {
            cloudSensitive: activity.cloudSensitive,
            shade: activity.shade,
            surface: activity.surface,
          }
        : {},
    })
    if (uv.kind === 'forecast' && eventHeadsUpWorthy(uv.peakUV)) {
      worthy.push({ item, zone, peakUV: uv.peakUV, peakAt: uv.peakAt })
    }
  }
  const first = worthy.find(entry => entry.item.due)
  if (!first) {
    // An event due now went without a forecast: the run's or the account's lookups ran out.
    return job.candidates.slice(job.looked).some(item => item.due) ? 'forecast-limit' : null
  }
  const others = worthy.filter(entry => entry !== first)

  const alert = eventHeadsUpMessage({
    title: first.item.title,
    placeLabel: first.item.placeLabel,
    startMs: first.item.startMs,
    timeZone: first.zone,
    peakUV: first.peakUV,
    peakAtMs: first.peakAt,
    nowMs: now,
    clock: clockOf(user),
    more: others.length,
  })
  const covered = others.map(other => other.item)
  return deliver(
    run,
    stateRef,
    doc.id,
    devices,
    {
      kind: 'event',
      field: first.item.key,
      day: first.item.key,
      key: eventDeliveryKey(first.item.key),
    },
    alert,
    () => claimHeadsUp(run.deps.db, stateRef, first.item, covered, run.now()),
    covered.map(item => item.key),
  )
}

/** The heads-ups gathered in the walk: forecasts shared out fairly, then sent. */
async function runHeadsUps(run: Run, jobs: HeadsUpJob[]): Promise<void> {
  planHeadsUpLookups(run, jobs)
  await mapLimit(jobs, run.limits.concurrency, async job => {
    if (run.outOfTime()) {
      // Still due in the next run, 15 minutes on.
      run.count('out-of-time')
      return
    }
    try {
      run.count((await sendHeadsUp(run, job)) ?? job.otherwise)
    } catch (error) {
      run.count('error')
      logger.error('event heads-up for an account failed', { error: loggableError(error) })
    }
  })
}

export async function mapLimit<T>(
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
  const headsUps: HeadsUpJob[] = []

  while (!run.walkOutOfTime() && scanned < run.limits.maxUsers) {
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
        const outcome = await processAccount(run, doc)
        if (typeof outcome === 'string') run.count(outcome)
        else headsUps.push(outcome)
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
  await runHeadsUps(run, headsUps)
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
  if (run.eventForecastLookups >= run.limits.maxEventForecasts) {
    logger.warn('alerts run reached its event forecast lookup limit', {
      maxEventForecasts: run.limits.maxEventForecasts,
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
