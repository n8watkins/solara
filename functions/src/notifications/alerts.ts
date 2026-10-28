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
// Event heads-ups (docs/integrations/EVENTS.md, phase 2; with EVENTS_SUBSCRIPTIONS_ENABLED):
// when no morning or UV alert goes out for an account in a run, every imported and
// linked event whose heads-up can be due now is checked (packages/core/src/
// event-heads-up.ts): only events that count as an outdoor activity, each event once
// however many sources hold a copy, and at most one push per account every 3 hours,
// naming the soonest high-UV event and counting the others it stands for (REVIEW5 M3).
// A push is claimed in `users/{uid}/alertState/events` with the events it covers. Their
// forecasts come through the shared cache within the global upstream budget and the
// account's own share of it, and a run looks up at most ALERTS_MAX_EVENT_FORECASTS_PER_RUN
// event places.

import {
  APP_FORECAST_DAYS,
  type AlertKind,
  type AlertMessage,
  type OpenMeteoResponse,
  type QuietHours,
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
  eventHeadsUpMessage,
  eventHeadsUpThrottled,
  eventHeadsUpWindowEnd,
  eventHeadsUpWorthy,
  eventTitleIdentity,
  eventUV,
  parseImportedEvent,
  withoutDuplicates,
} from '#core/event-import'
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
 * Most upcoming events read per account and run for heads-ups: every event an account
 * can hold (REVIEW5 M3), though a run reads only those whose heads-up can be due now
 * (usually the next 3 hours, `eventHeadsUpWindowEnd`).
 */
export const EVENT_HEADS_UP_EVENTS_PER_ACCOUNT = IMPORTED_EVENT_LIMITS.maxStored
/** Heads-ups an account keeps a record of; older ones are dropped from its state. */
const EVENT_STATE_MAX_ENTRIES = 50
export const ALERTS_CONCURRENCY = 10
/** A run stops starting new accounts after this long (the Function's timeout is 300 s). */
export const ALERTS_RUN_BUDGET_MS = 240_000
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
   * Event heads-ups (EVENTS_SUBSCRIPTIONS_ENABLED): the forecast at an event's place for
   * an account, through the shared cache within the upstream budget and the account's
   * share. Absent: no heads-ups are sent.
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
  concurrency: number
  budgetMs: number
}

const DEFAULT_LIMITS: AlertLimits = {
  pageSize: ALERTS_PAGE_SIZE,
  maxUsers: ALERTS_MAX_USERS_PER_RUN,
  maxForecasts: ALERTS_MAX_FORECASTS_PER_RUN,
  maxEventForecasts: ALERTS_MAX_EVENT_FORECASTS_PER_RUN,
  concurrency: ALERTS_CONCURRENCY,
  budgetMs: ALERTS_RUN_BUDGET_MS,
}

/** What is sent: a morning or UV alert, or an event heads-up. */
export type SentKind = AlertKind | 'event'

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
  readonly sent: Partial<Record<SentKind, number>> = {}
  removedDevices = 0
  forecastLookups = 0
  eventForecastLookups = 0
  private readonly forecasts = new Map<string, Promise<OpenMeteoResponse | null>>()
  private readonly eventForecasts = new Map<string, Promise<OpenMeteoResponse | null>>()

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

  /**
   * The forecast at an event's place for an account, once per run and place; 'limit'
   * past the run's event forecast cap, null when it cannot be had.
   */
  eventForecast(
    lat: number,
    lon: number,
    uid: string,
  ): Promise<OpenMeteoResponse | null> | 'limit' | null {
    const lookupFor = this.deps.eventForecast
    if (!lookupFor) return null
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const known = this.eventForecasts.get(key) ?? this.forecasts.get(key)
    if (known) return known
    if (this.eventForecastLookups >= this.limits.maxEventForecasts) return 'limit'
    this.eventForecastLookups += 1
    const lookup = lookupFor({ lat, lon }, uid).catch(error => {
      logger.warn('event forecast unavailable', { error: loggableError(error) })
      return null
    })
    this.eventForecasts.set(key, lookup)
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
interface Delivery {
  kind: SentKind
  /** The field of the state document that records it. */
  field: string
  /** The value that marks it sent: a local day, or the event's key. */
  day: string
  key: string
}

function messageFor(
  delivery: Delivery,
  uid: string,
  token: string,
  alert: AlertMessage,
  appUrl: string,
): Message {
  const { kind, key } = delivery
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
    webpush: { headers: { Urgency: kind === 'morning' ? 'normal' : 'high', TTL: '3600' } },
    android: { collapseKey: key, ttl: 3_600_000 },
    apns: { headers: { 'apns-collapse-id': key } },
  }
}

/**
 * Sends one alert to every device and records the outcome. `claimWith` replaces the
 * daily claim (event heads-ups claim with the events they cover); `covered` are those
 * events' fields, released again when the send failed for certain.
 */
async function deliver(
  run: Run,
  stateRef: DocumentReference,
  uid: string,
  devices: Device[],
  delivery: Delivery,
  alert: AlertMessage,
  claimWith?: () => Promise<{ attemptId: string } | null>,
  covered: readonly string[] = [],
): Promise<AlertOutcome> {
  const { db, messaging, appUrl } = run.deps
  const { kind, field, day } = delivery
  const claimed = await (claimWith ?? (() => claim(db, stateRef, field, day, run.now())))()
  if (!claimed) return 'claim-lost'

  let response: BatchResponse
  try {
    response = await messaging.sendEach(
      devices.map(device => messageFor(delivery, uid, device.token, alert, appUrl)),
    )
  } catch (error) {
    // Some messages may have gone out: the alert is not tried again today.
    logger.error('alert delivery outcome unknown', { kind, error: loggableError(error) })
    await finish(
      db,
      stateRef,
      field,
      claimed.attemptId,
      { status: 'unknown', delivered: 0, error: String((error as Error)?.message ?? error) },
      run.now(),
      covered,
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
    field,
    claimed.attemptId,
    {
      status,
      delivered: response.successCount,
      ...(codes.length ? { error: codes.map(String).join(',') } : {}),
    },
    run.now(),
    covered,
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

/** The devices of an account, read once per run however many alerts look for them. */
function devicesOnce(run: Run, userRef: DocumentReference): () => Promise<Device[]> {
  let pending: Promise<Device[]> | null = null
  return () => (pending ??= alertDevices(run.deps.db, userRef))
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

  const quiet = quietHours(user.quietHours)
  const devices = devicesOnce(run, doc.ref)
  const daily = await dailyAlert(run, doc, { forecast, local, quiet, devices })
  // At most one alert per account and run: a heads-up only when nothing else went out.
  if (daily !== 'not-due' && daily !== 'already-sent') return daily
  const headsUp = await eventHeadsUp(run, doc, { timeZone, quiet, devices })
  return headsUp ?? daily
}

/** The morning or UV alert, when one is due. */
async function dailyAlert(
  run: Run,
  doc: QueryDocumentSnapshot,
  {
    forecast: known,
    local,
    quiet,
    devices: readDevices,
  }: {
    forecast: OpenMeteoResponse | null | undefined
    local: { date: string; hour: number }
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
  primary: DueEvent,
  covered: readonly DueEvent[],
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
    const record = (item: DueEvent) => ({ same: titleHash(item.title), startMs: item.startMs })
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

/** An upcoming event whose heads-up is due now. */
interface DueEvent extends ImportedEvent {
  startMs: number
}

/**
 * A heads-up before the account's soonest high-UV outdoor event, when one is due; null
 * when none is (so the account's outcome stays what the daily alerts said).
 */
async function eventHeadsUp(
  run: Run,
  doc: QueryDocumentSnapshot,
  {
    timeZone,
    quiet,
    devices: readDevices,
  }: { timeZone: string; quiet: QuietHours; devices: () => Promise<Device[]> },
): Promise<AlertOutcome | null> {
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

  // Every event whose heads-up can be due now, not just the soonest few.
  const from = new Date(now + EVENT_HEADS_UP.latestMinutes * 60_000).toISOString()
  const to = new Date(eventHeadsUpWindowEnd(now, timeZone, quiet)).toISOString()
  const snapshot = await doc.ref
    .collection('events')
    .where('start', '>', from)
    .where('start', '<=', to)
    .orderBy('start')
    .limit(EVENT_HEADS_UP_EVENTS_PER_ACCOUNT)
    .get()
  const due = withoutDuplicates(
    snapshot.docs.flatMap(event => {
      const item = parseImportedEvent(event.data())
      if (!item || item.key !== event.id || !countsAsOutdoorActivity(item, activities)) return []
      const startMs = Date.parse(item.start)
      return eventHeadsUpDue({ startMs, nowMs: now, timeZone, quiet }) ? [{ ...item, startMs }] : []
    }),
  )
  const open = due.filter(item => !alreadyHeard(state, item))
  if (open.length === 0) return null

  const devices = await readDevices()
  if (devices.length === 0) return 'no-devices'

  // The UV at each one, soonest first; the push names the soonest high one.
  const worthy: { item: DueEvent; zone: string; peakUV: number; peakAt: number }[] = []
  let limited = false
  for (const item of open) {
    const lookup = run.eventForecast(item.lat, item.lon, doc.id)
    if (lookup === 'limit') {
      limited = true
      break
    }
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
  const [first, ...others] = worthy
  if (!first) return limited ? 'forecast-limit' : null

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
