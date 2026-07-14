const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { createHash, randomUUID } = require('node:crypto')
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

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const FORCE_SEND = process.env.FORCE_SEND === '1' || process.env.FORCE_SEND === 'true'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'
const CONCURRENCY = Math.max(1, Number(process.env.NOTIFICATION_CONCURRENCY || 10))
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `github:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`
  : `local:${process.pid}:${Date.now()}`

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

let db
let messaging
const forecastCache = new Map()

function notificationScope(uid) {
  return createHash('sha256').update(`solara-notification:${uid}`).digest('base64url').slice(0, 22)
}

function forecastCacheKey(lat, lon) {
  return `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`
}

async function fetchHourly(lat, lon) {
  const key = forecastCacheKey(lat, lon)
  if (forecastCache.has(key)) return forecastCache.get(key)

  const request = (async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index,temperature_2m,weathercode&timezone=auto&forecast_days=1`
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`)
    const data = await response.json()
    if (!data.hourly?.time || !data.timezone) throw new Error('Forecast response was incomplete')
    const local = localParts(new Date(), data.timezone)
    const hourly = data.hourly.time
      .map((time, index) => ({
        date: time.split('T')[0],
        hour: Number(time.split('T')[1].split(':')[0]),
        uv: Math.round(data.hourly.uv_index[index] * 10) / 10,
        tempF: Math.round(data.hourly.temperature_2m[index] * 9 / 5 + 32),
        condition: weatherLabel(data.hourly.weathercode[index]),
      }))
      .filter(sample => sample.date === local?.date && sample.hour >= 6 && sample.hour <= 20)
    return { hourly, timezone: data.timezone }
  })()
  forecastCache.set(key, request)
  return request
}

async function loadSubscriptions() {
  const [devices, legacyUsers] = await Promise.all([
    db.collectionGroup('notificationDevices').where('enabled', '==', true).get(),
    db.collection('users').where('notificationsEnabled', '==', true).get(),
  ])
  const subscriptions = []
  const tokens = new Set()

  for (const deviceDoc of devices.docs) {
    const token = deviceDoc.data().token
    const userRef = deviceDoc.ref.parent.parent
    if (!token || !userRef || tokens.has(token)) continue
    tokens.add(token)
    subscriptions.push({ token, deviceRef: deviceDoc.ref, userRef, lastNotificationKey: deviceDoc.data().lastNotificationKey })
  }

  for (const userDoc of legacyUsers.docs) {
    const token = userDoc.data().fcmToken
    if (!token || tokens.has(token)) continue
    tokens.add(token)
    subscriptions.push({ token, deviceRef: userDoc.ref, userRef: userDoc.ref, lastNotificationKey: userDoc.data().lastNotificationKey, legacy: true })
  }
  return subscriptions
}

async function claimDelivery(subscription, key, attemptId, database = db, nowMs = Date.now()) {
  return database.runTransaction(async transaction => {
    const snapshot = await transaction.get(subscription.deviceRef)
    if (!snapshot.exists) return { claimed: false, reason: 'missing-subscription' }

    const delivery = claimDecision(snapshot.data(), key, { nowMs })
    if (!delivery.claim) return { claimed: false, reason: delivery.reason }

    const priorAttempts = snapshot.data().notificationDeliveryKey === key
      ? Number(snapshot.data().notificationDeliveryAttemptCount || 0)
      : 0
    transaction.set(subscription.deviceRef, {
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
    }, { merge: true })
    return { claimed: true, retry: delivery.retry }
  })
}

async function finishDelivery(subscription, key, attemptId, patch, database = db) {
  return database.runTransaction(async transaction => {
    const snapshot = await transaction.get(subscription.deviceRef)
    if (!snapshot.exists) return false
    const current = snapshot.data()
    if (current.notificationDeliveryKey !== key || current.notificationDeliveryAttemptId !== attemptId) {
      return false
    }
    transaction.set(subscription.deviceRef, {
      ...patch,
      notificationDeliveryUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
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
  await finishDelivery(subscription, key, attemptId, {
    ...cleanup,
    notificationDeliveryStatus: certainty === 'definite' ? 'failed' : 'unknown',
    notificationDeliveryError: errorText(error),
    notificationDeliveryErrorAt: FieldValue.serverTimestamp(),
    lastError: errorText(error),
  }, database)
  return { certainty, deadToken }
}

async function sendSubscription(subscription, now) {
  const userSnap = await subscription.userRef.get()
  if (!userSnap.exists) return { outcome: 'skipped', reason: 'missing-user' }
  const user = userSnap.data()
  if (!isEligibleUser(user)) return { outcome: 'skipped', reason: 'ineligible-user' }

  const forecast = await fetchHourly(user.location.lat, user.location.lon)
  const timezone = user.location.timezone || forecast.timezone
  const decision = deliveryDecision(user, timezone, subscription.lastNotificationKey, {
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
      data: { title, body, deliveryKey: key, deliveryScope: notificationScope(userSnap.id), link: SITE_URL },
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
      console.error(JSON.stringify({
        event: 'notification-delivery-unknown',
        key,
        attemptId,
        runId: RUN_ID,
        subscriptionPath: subscription.deviceRef.path,
        error: errorText(error),
      }))
    }
    throw error
  }
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is required')
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
  db = getFirestore()
  messaging = getMessaging()

  const subscriptions = await loadSubscriptions()
  console.log(`${DRY_RUN ? 'Dry run for' : 'Processing'} ${subscriptions.length} notification subscription(s)`)
  const results = await mapLimit(subscriptions, CONCURRENCY, subscription => sendSubscription(subscription, new Date()))
  const counts = {}
  for (const result of results) {
    const outcome = result.status === 'fulfilled' ? result.value.outcome : 'failed'
    counts[outcome] = (counts[outcome] || 0) + 1
    if (result.status === 'rejected') console.error(result.reason)
  }
  console.log('Notification run complete:', counts)
  if (counts.failed) process.exitCode = 1
}

module.exports = {
  claimDelivery,
  fetchHourly,
  finishDelivery,
  loadSubscriptions,
  notificationScope,
  recordDeliveryFailure,
  sendSubscription,
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1) })
}
