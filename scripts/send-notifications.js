const { applicationDefault, cert, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldPath, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { createHash, randomUUID } = require('node:crypto')
const { tokenOwnerId } = require('../functions/lib/notification-devices')
const {
  buildMessage,
  claimDecision,
  deliveryDecision,
  failureCertainty,
  isEligibleUser,
  localParts,
  mapLimit,
  weatherLabel,
} = require('./notification-core')
const {
  fetchJson,
  forecastUrl,
  isPlannableHour,
  parseHourlyRows,
} = require('../functions/lib/forecast-core')

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const FORCE_SEND = process.env.FORCE_SEND === '1' || process.env.FORCE_SEND === 'true'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'
function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const CONCURRENCY = positiveInteger(process.env.NOTIFICATION_CONCURRENCY, 10)
const SUBSCRIPTION_PAGE_SIZE = positiveInteger(process.env.NOTIFICATION_PAGE_SIZE, 200)
const FORECAST_CACHE_SIZE = positiveInteger(process.env.NOTIFICATION_FORECAST_CACHE_SIZE, 500)
const MAX_DISPATCH_PAGES = positiveInteger(process.env.NOTIFICATION_MAX_PAGES, 4)
const RUN_BUDGET_MS = positiveInteger(process.env.NOTIFICATION_RUN_BUDGET_MS, 8 * 60 * 1000)
const CHECKPOINT_RESERVE_MS = positiveInteger(
  process.env.NOTIFICATION_CHECKPOINT_RESERVE_MS,
  30_000,
)
const DISPATCH_BATCH_SIZE = Math.min(SUBSCRIPTION_PAGE_SIZE, CONCURRENCY)
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `github:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`
  : `local:${process.pid}:${Date.now()}`

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

let db
let messaging
const forecastCache = new Map()

function notificationScope(uid) {
  return createHash('sha256').update(`solara-notification:${uid}`).digest('base64url').slice(0, 22)
}

function dispatchStateDocumentId(dryRun) {
  return dryRun ? 'morning-dry-run' : 'morning'
}

function forecastCacheKey(lat, lon) {
  return `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`
}

const FORECAST_ATTEMPTS = 2

/** Today's daytime (06-20) hours with a known UV, in the forecast's own timezone. */
function parseNotificationForecast(data, now = new Date()) {
  const rows = parseHourlyRows(data)
  if (typeof data.timezone !== 'string' || !data.timezone) {
    throw new Error('Forecast response was incomplete')
  }
  const local = localParts(now, data.timezone)
  const hourly = rows
    .filter(row => row.date === local?.date && isPlannableHour(row))
    .map(row => ({
      date: row.date,
      hour: row.hour,
      uv: row.uv,
      tempF: row.tempF,
      condition: weatherLabel(row.weatherCode),
    }))
  return { hourly, timezone: data.timezone }
}

async function requestForecast(lat, lon, fetchImpl) {
  const url = forecastUrl({
    lat,
    lon,
    days: 1,
    hourly: ['uv_index', 'temperature_2m', 'weathercode'],
  })
  let lastError
  for (let attempt = 1; attempt <= FORECAST_ATTEMPTS; attempt++) {
    try {
      return parseNotificationForecast(await fetchJson(url, { fetchImpl }))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * Today's forecast for a location, shared by every subscriber in the same grid
 * cell for the rest of the run. Each request times out after 5 s and is retried
 * once; a failed lookup is evicted so a later subscriber tries again.
 */
async function fetchHourly(lat, lon, { fetchImpl } = {}) {
  const key = forecastCacheKey(lat, lon)
  if (forecastCache.has(key)) {
    const cached = forecastCache.get(key)
    forecastCache.delete(key)
    forecastCache.set(key, cached)
    return cached
  }

  const request = requestForecast(lat, lon, fetchImpl)
  forecastCache.set(key, request)
  if (forecastCache.size > FORECAST_CACHE_SIZE) {
    forecastCache.delete(forecastCache.keys().next().value)
  }
  request.catch(() => {
    if (forecastCache.get(key) === request) forecastCache.delete(key)
  })
  return request
}

function clearForecastCache() {
  forecastCache.clear()
}

function deviceCandidate(deviceDoc) {
  if (deviceDoc.data().registrationMigrationId) return null
  const token = deviceDoc.data().token
  const userRef = deviceDoc.ref.parent.parent
  if (!token || !userRef) return null
  return {
    token,
    deviceId: deviceDoc.id,
    deviceRef: deviceDoc.ref,
    userRef,
    lastNotificationKey: deviceDoc.data().lastNotificationKey,
  }
}

function legacyCandidate(userDoc) {
  const token = userDoc.data().fcmToken
  if (!token) return null
  return {
    token,
    deviceRef: userDoc.ref,
    userRef: userDoc.ref,
    lastNotificationKey: userDoc.data().lastNotificationKey,
    legacy: true,
  }
}

async function runBounded(items, worker) {
  const results = await mapLimit(items, CONCURRENCY, worker)
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(
        JSON.stringify({
          event: 'notification-quarantine-failed',
          subscriptionPath: items[index].deviceRef.path,
          error: errorText(result.reason),
        }),
      )
    }
  }
}

async function quarantineCandidate(candidate, database = db) {
  const ownerRef = database.collection('notificationTokenOwners').doc(tokenOwnerId(candidate.token))
  return database.runTransaction(async transaction => {
    const [candidateSnapshot, ownerSnapshot] = await Promise.all([
      transaction.get(candidate.deviceRef),
      transaction.get(ownerRef),
    ])
    if (!candidateSnapshot.exists) return false
    const current = candidateSnapshot.data()
    const stillCandidate = candidate.legacy
      ? current.notificationsEnabled === true && current.fcmToken === candidate.token
      : current.enabled === true && current.token === candidate.token
    if (!stillCandidate) return false
    const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null
    if (
      !candidate.legacy &&
      owner?.uid === candidate.userRef.id &&
      owner.deviceId === candidate.deviceId
    )
      return false
    const patch = candidate.legacy
      ? { fcmToken: null, notificationsEnabled: false }
      : { enabled: false, updatedAt: FieldValue.serverTimestamp() }
    transaction.set(candidate.deviceRef, patch, { merge: true })
    return true
  })
}

async function ownerSnapshots(candidates, database) {
  const refs = candidates.map(candidate =>
    database.collection('notificationTokenOwners').doc(tokenOwnerId(candidate.token)),
  )
  return refs.length ? database.getAll(...refs) : []
}

async function resolveDevicePage(candidates, database) {
  const owners = await ownerSnapshots(candidates, database)
  const subscriptions = []
  const quarantine = []
  for (const [index, candidate] of candidates.entries()) {
    const owner = owners[index]?.exists ? owners[index].data() : null
    if (owner?.uid === candidate.userRef.id && owner.deviceId === candidate.deviceId) {
      subscriptions.push(candidate)
    } else {
      quarantine.push(candidate)
    }
  }
  await runBounded(quarantine, candidate => quarantineCandidate(candidate, database))
  return subscriptions
}

function finishLegacyGroup(state, subscriptions) {
  if (state.candidate && !state.blocked) subscriptions.push(state.candidate)
  state.token = null
  state.candidate = null
  state.blocked = false
}

async function resolveLegacyPage(candidates, state, database, final = false) {
  const owners = await ownerSnapshots(candidates, database)
  const subscriptions = []
  const quarantine = []
  for (const [index, candidate] of candidates.entries()) {
    if (state.token !== null && state.token !== candidate.token) {
      finishLegacyGroup(state, subscriptions)
    }
    if (state.token === null) state.token = candidate.token

    const owner = owners[index]?.exists ? owners[index].data() : null
    if (owner?.registrationMigrationId) {
      state.candidate = null
      state.blocked = true
    } else if (owner) {
      if (state.candidate) quarantine.push(state.candidate)
      state.candidate = null
      state.blocked = true
      quarantine.push(candidate)
    } else if (state.blocked) {
      quarantine.push(candidate)
    } else if (state.candidate) {
      quarantine.push(state.candidate, candidate)
      state.candidate = null
      state.blocked = true
    } else {
      state.candidate = candidate
    }
  }
  if (final) finishLegacyGroup(state, subscriptions)
  await runBounded(quarantine, candidate => quarantineCandidate(candidate, database))
  return subscriptions
}

function restoreLegacyState(state, database) {
  const uid = state.legacyCandidateUid
  return {
    token: state.legacyGroupToken || null,
    blocked: state.legacyGroupBlocked === true,
    candidate: uid
      ? {
          token: state.legacyCandidateToken,
          deviceRef: database.collection('users').doc(uid),
          userRef: database.collection('users').doc(uid),
          lastNotificationKey: state.legacyCandidateLastNotificationKey,
          legacy: true,
        }
      : null,
  }
}

function persistedLegacyState(state) {
  return {
    legacyGroupToken: state.token,
    legacyGroupBlocked: state.blocked,
    legacyCandidateUid: state.candidate?.userRef.id || null,
    legacyCandidateToken: state.candidate?.token || null,
    legacyCandidateLastNotificationKey: state.candidate?.lastNotificationKey || null,
  }
}

async function scanSubscriptions(
  database = db,
  onBatch = async () => {},
  pageSize = SUBSCRIPTION_PAGE_SIZE,
  options = {},
) {
  const maxPages = positiveInteger(options.maxPages, MAX_DISPATCH_PAGES)
  const now = options.now || Date.now
  const deadline = options.deadline || now() + RUN_BUDGET_MS
  const checkpointReserveMs = positiveInteger(options.checkpointReserveMs, CHECKPOINT_RESERVE_MS)
  const stored = options.stateStore ? await options.stateStore.load() : {}
  const state = {
    nextPhase: stored?.nextPhase === 'legacy' ? 'legacy' : 'devices',
    deviceCursor: stored?.deviceCursor || null,
    legacyCursorToken: stored?.legacyCursorToken || null,
    legacyCursorId: stored?.legacyCursorId || null,
    ...persistedLegacyState(restoreLegacyState(stored || {}, database)),
  }
  const completed = new Set()
  let pages = 0

  while (pages < maxPages && now() + checkpointReserveMs < deadline && completed.size < 2) {
    const phase = state.nextPhase
    state.nextPhase = phase === 'devices' ? 'legacy' : 'devices'
    if (completed.has(phase)) continue

    if (phase === 'devices') {
      let query = database
        .collectionGroup('notificationDevices')
        .where('enabled', '==', true)
        .orderBy(FieldPath.documentId())
      if (state.deviceCursor) query = query.startAfter(state.deviceCursor)
      const snapshot = await query.limit(pageSize).get()
      pages++
      const finished = snapshot.docs.length < pageSize
      if (snapshot.docs.length) {
        const candidates = snapshot.docs.map(deviceCandidate).filter(Boolean)
        const subscriptions = await resolveDevicePage(candidates, database)
        if (subscriptions.length) {
          const processed = await onBatch(subscriptions, { deadline, checkpointReserveMs })
          if (processed === false) return { pages, state }
        }
      }
      state.deviceCursor = finished ? null : snapshot.docs.at(-1).ref.path
      if (finished) completed.add(phase)
    } else {
      let query = database
        .collection('users')
        .where('notificationsEnabled', '==', true)
        .orderBy('fcmToken')
        .orderBy(FieldPath.documentId())
      if (state.legacyCursorToken) {
        query = query.startAfter(state.legacyCursorToken, state.legacyCursorId)
      }
      const snapshot = await query.limit(pageSize).get()
      pages++
      const finished = snapshot.docs.length < pageSize
      const legacyState = restoreLegacyState(state, database)
      const candidates = snapshot.docs.map(legacyCandidate).filter(Boolean)
      const subscriptions = await resolveLegacyPage(candidates, legacyState, database, finished)
      if (subscriptions.length) {
        const processed = await onBatch(subscriptions, { deadline, checkpointReserveMs })
        if (processed === false) return { pages, state }
      }
      const last = snapshot.docs.at(-1)
      state.legacyCursorToken = finished ? null : last.data().fcmToken
      state.legacyCursorId = finished ? null : last.id
      Object.assign(state, persistedLegacyState(legacyState))
      if (finished) completed.add(phase)
    }

    if (options.stateStore) await options.stateStore.save(state)
  }

  return { pages, state }
}

async function claimDelivery(subscription, key, attemptId, database = db) {
  return database.runTransaction(async transaction => {
    const ownerRef = database
      .collection('notificationTokenOwners')
      .doc(tokenOwnerId(subscription.token))
    const [snapshot, ownerSnapshot, userSnapshot] = await Promise.all([
      transaction.get(subscription.deviceRef),
      transaction.get(ownerRef),
      transaction.get(subscription.userRef),
    ])
    if (!snapshot.exists) return { claimed: false, reason: 'missing-subscription' }
    if (!userSnapshot.exists || !isEligibleUser(userSnapshot.data())) {
      return { claimed: false, reason: 'ineligible-user' }
    }

    const current = snapshot.data()
    const validSubscription = subscription.legacy
      ? current.notificationsEnabled === true &&
        current.fcmToken === subscription.token &&
        !ownerSnapshot.exists
      : current.enabled === true &&
        current.token === subscription.token &&
        ownerSnapshot.exists &&
        ownerSnapshot.data().uid === subscription.userRef.id &&
        ownerSnapshot.data().deviceId === subscription.deviceId
    if (!validSubscription) return { claimed: false, reason: 'ownership-changed' }

    const delivery = claimDecision(current, key)
    if (!delivery.claim) return { claimed: false, reason: delivery.reason }

    const priorAttempts =
      current.notificationDeliveryKey === key
        ? Number(current.notificationDeliveryAttemptCount || 0)
        : 0
    transaction.set(
      subscription.deviceRef,
      {
        notificationDeliveryKey: key,
        notificationDeliveryStatus: 'claimed',
        notificationDeliveryAttemptId: attemptId,
        notificationDeliveryAttemptCount: priorAttempts + 1,
        notificationDeliveryClaimedAt: FieldValue.serverTimestamp(),
        notificationDeliveryUpdatedAt: FieldValue.serverTimestamp(),
        notificationDeliveryRunId: RUN_ID,
        notificationDeliveryCompletedAt: FieldValue.delete(),
        notificationDeliveryError: FieldValue.delete(),
        notificationDeliveryErrorAt: FieldValue.delete(),
        lastError: FieldValue.delete(),
      },
      { merge: true },
    )
    return { claimed: true, retry: delivery.retry }
  })
}

async function finishDelivery(subscription, key, attemptId, patch, database = db) {
  return database.runTransaction(async transaction => {
    const ownerRef = database
      .collection('notificationTokenOwners')
      .doc(tokenOwnerId(subscription.token))
    const [snapshot, ownerSnapshot] = await Promise.all([
      transaction.get(subscription.deviceRef),
      transaction.get(ownerRef),
    ])
    if (!snapshot.exists) return false
    const current = snapshot.data()
    const validSubscription = subscription.legacy
      ? current.notificationsEnabled === true &&
        current.fcmToken === subscription.token &&
        !ownerSnapshot.exists
      : current.enabled === true &&
        current.token === subscription.token &&
        ownerSnapshot.exists &&
        ownerSnapshot.data().uid === subscription.userRef.id &&
        ownerSnapshot.data().deviceId === subscription.deviceId
    if (!validSubscription) return false
    if (
      current.notificationDeliveryKey !== key ||
      current.notificationDeliveryAttemptId !== attemptId
    ) {
      return false
    }
    transaction.set(
      subscription.deviceRef,
      {
        ...patch,
        notificationDeliveryUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return true
  })
}

function errorText(error) {
  return String(error?.code || error?.message || error).slice(0, 500)
}

async function recordDeliveryFailure(subscription, key, attemptId, error, database = db) {
  const certainty = failureCertainty(error)
  const deadToken = DEAD_TOKEN_CODES.has(error?.code)
  const cleanup = deadToken
    ? subscription.legacy
      ? { fcmToken: null, notificationsEnabled: false }
      : { enabled: false, updatedAt: FieldValue.serverTimestamp() }
    : {}
  await finishDelivery(
    subscription,
    key,
    attemptId,
    {
      ...cleanup,
      notificationDeliveryStatus: certainty === 'definite' ? 'failed' : 'unknown',
      notificationDeliveryError: errorText(error),
      notificationDeliveryErrorAt: FieldValue.serverTimestamp(),
      lastError: errorText(error),
    },
    database,
  )
  return { certainty, deadToken }
}

async function sendSubscription(subscription, now) {
  const userSnap = await subscription.userRef.get()
  if (!userSnap.exists) return { outcome: 'skipped', reason: 'missing-user' }
  const user = userSnap.data()
  if (!isEligibleUser(user)) return { outcome: 'skipped', reason: 'ineligible-user' }

  let decision = null
  if (user.location.timezone) {
    decision = deliveryDecision(user, user.location.timezone, subscription.lastNotificationKey, {
      dryRun: DRY_RUN,
      forceSend: FORCE_SEND,
      now,
    })
    if (!decision.deliver) return { outcome: 'skipped', reason: decision.reason }
  }

  const forecast = await fetchHourly(user.location.lat, user.location.lon)
  const timezone = user.location.timezone || forecast.timezone
  decision ||= deliveryDecision(user, timezone, subscription.lastNotificationKey, {
    dryRun: DRY_RUN,
    forceSend: FORCE_SEND,
    now,
  })
  if (!decision.deliver) return { outcome: 'skipped', reason: decision.reason }
  const key = decision.key

  const local = localParts(now, timezone)
  const { title, body } = buildMessage(user, forecast.hourly, local?.date)
  if (DRY_RUN) return { outcome: 'dry-run', title, userId: userSnap.id }

  const attemptId = randomUUID()
  const claim = await claimDelivery(subscription, key, attemptId)
  if (!claim.claimed) return { outcome: 'skipped', reason: claim.reason }

  try {
    await messaging.send({
      token: subscription.token,
      data: {
        title,
        body,
        deliveryKey: key,
        deliveryScope: notificationScope(userSnap.id),
        link: SITE_URL,
      },
      webpush: {
        headers: { Urgency: 'high' },
      },
      android: {
        collapseKey: key,
      },
      apns: {
        headers: { 'apns-collapse-id': key },
      },
    })
    const finalized = await finishDelivery(subscription, key, attemptId, {
      lastNotificationKey: key,
      lastDeliveredAt: FieldValue.serverTimestamp(),
      notificationDeliveryStatus: 'delivered',
      notificationDeliveryCompletedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
    })
    if (!finalized) throw new Error('Notification delivery claim was lost before completion')
    return { outcome: 'sent', title, userId: userSnap.id, key, attemptId, retry: claim.retry }
  } catch (error) {
    const failure = await recordDeliveryFailure(subscription, key, attemptId, error)
    if (failure.deadToken) {
      return { outcome: 'cleaned', reason: error.code, key, attemptId }
    }
    if (failure.certainty === 'unknown') {
      console.error(
        JSON.stringify({
          event: 'notification-delivery-unknown',
          key,
          attemptId,
          runId: RUN_ID,
          subscriptionPath: subscription.deviceRef.path,
          error: errorText(error),
        }),
      )
    }
    throw error
  }
}

async function main() {
  // A JSON key is optional: without one, Application Default Credentials apply (Workload
  // Identity Federation in CI, or `gcloud auth application-default login` locally).
  initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : applicationDefault(),
  })
  db = getFirestore()
  messaging = getMessaging()

  const counts = {}
  let processed = 0
  const dispatchStateRef = db
    .collection('notificationDispatchState')
    .doc(dispatchStateDocumentId(DRY_RUN))
  const stateStore = {
    load: async () => {
      const snapshot = await dispatchStateRef.get()
      return snapshot.exists ? snapshot.data() : {}
    },
    save: state => dispatchStateRef.set({ ...state, updatedAt: FieldValue.serverTimestamp() }),
  }
  console.log(`${DRY_RUN ? 'Dry-running' : 'Processing'} notification subscriptions in pages`)
  const deadline = Date.now() + RUN_BUDGET_MS
  await scanSubscriptions(
    db,
    async (subscriptions, batch) => {
      if (Date.now() + batch.checkpointReserveMs >= batch.deadline) return false
      processed += subscriptions.length
      const results = await mapLimit(subscriptions, CONCURRENCY, subscription =>
        sendSubscription(subscription, new Date()),
      )
      for (const result of results) {
        const outcome = result.status === 'fulfilled' ? result.value.outcome : 'failed'
        counts[outcome] = (counts[outcome] || 0) + 1
        if (result.status === 'rejected') console.error(result.reason)
      }
    },
    DISPATCH_BATCH_SIZE,
    {
      deadline,
      maxPages: Math.ceil((MAX_DISPATCH_PAGES * SUBSCRIPTION_PAGE_SIZE) / DISPATCH_BATCH_SIZE),
      stateStore,
    },
  )
  console.log(`Processed ${processed} notification subscription(s)`)
  console.log('Notification run complete:', counts)
  if (counts.failed) process.exitCode = 1
}

module.exports = {
  claimDelivery,
  clearForecastCache,
  dispatchStateDocumentId,
  fetchHourly,
  finishDelivery,
  notificationScope,
  parseNotificationForecast,
  recordDeliveryFailure,
  scanSubscriptions,
  sendSubscription,
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
