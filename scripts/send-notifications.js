const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
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

async function loadSubscriptions(database = db) {
  const [devices, legacyUsers] = await Promise.all([
    database.collectionGroup('notificationDevices').where('enabled', '==', true).get(),
    database.collection('users').where('notificationsEnabled', '==', true).get(),
  ])
  const candidatesByToken = new Map()
  const addCandidate = candidate => {
    const candidates = candidatesByToken.get(candidate.token) || []
    candidates.push(candidate)
    candidatesByToken.set(candidate.token, candidates)
  }

  for (const deviceDoc of devices.docs) {
    const token = deviceDoc.data().token
    const userRef = deviceDoc.ref.parent.parent
    if (!token || !userRef) continue
    addCandidate({
      token,
      deviceId: deviceDoc.id,
      deviceRef: deviceDoc.ref,
      userRef,
      lastNotificationKey: deviceDoc.data().lastNotificationKey,
    })
  }

  for (const userDoc of legacyUsers.docs) {
    const token = userDoc.data().fcmToken
    if (!token) continue
    addCandidate({
      token,
      deviceRef: userDoc.ref,
      userRef: userDoc.ref,
      lastNotificationKey: userDoc.data().lastNotificationKey,
      legacy: true,
    })
  }

  const tokens = [...candidatesByToken.keys()]
  const ownerRefs = tokens.map(token => database.collection('notificationTokenOwners').doc(tokenOwnerId(token)))
  const ownerSnapshots = ownerRefs.length ? await database.getAll(...ownerRefs) : []
  const subscriptions = []
  const quarantineWrites = []
  const quarantine = (candidate, quarantineWithoutOwner = false) => {
    const ownerRef = database.collection('notificationTokenOwners').doc(tokenOwnerId(candidate.token))
    quarantineWrites.push(database.runTransaction(async transaction => {
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
      if (!candidate.legacy && owner?.uid === candidate.userRef.id
        && owner.deviceId === candidate.deviceId) return false
      if (candidate.legacy && !owner && !quarantineWithoutOwner) return false
      const patch = candidate.legacy
        ? { fcmToken: null, notificationsEnabled: false }
        : { enabled: false, updatedAt: FieldValue.serverTimestamp() }
      transaction.set(candidate.deviceRef, patch, { merge: true })
      return true
    }))
  }
  for (const [index, token] of tokens.entries()) {
    const candidates = candidatesByToken.get(token)
    const owner = ownerSnapshots[index]?.exists ? ownerSnapshots[index].data() : null
    if (owner) {
      const ownedDevice = candidates.find(candidate => !candidate.legacy
        && candidate.userRef.id === owner.uid
        && candidate.deviceId === owner.deviceId)
      if (ownedDevice) subscriptions.push(ownedDevice)
      for (const candidate of candidates) {
        if (candidate !== ownedDevice) quarantine(candidate)
      }
      continue
    }
    if (candidates.length === 1 && candidates[0].legacy) {
      subscriptions.push(candidates[0])
    } else {
      for (const candidate of candidates) quarantine(candidate, true)
    }
  }
  await Promise.all(quarantineWrites)
  return subscriptions
}

async function claimDelivery(subscription, key, attemptId, database = db, nowMs = Date.now()) {
  return database.runTransaction(async transaction => {
    const ownerRef = database.collection('notificationTokenOwners')
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
      ? current.notificationsEnabled === true
        && current.fcmToken === subscription.token
        && !ownerSnapshot.exists
      : current.enabled === true
        && current.token === subscription.token
        && ownerSnapshot.exists
        && ownerSnapshot.data().uid === subscription.userRef.id
        && ownerSnapshot.data().deviceId === subscription.deviceId
    if (!validSubscription) return { claimed: false, reason: 'ownership-changed' }

    const delivery = claimDecision(current, key, { nowMs })
    if (!delivery.claim) return { claimed: false, reason: delivery.reason }

    const priorAttempts = current.notificationDeliveryKey === key
      ? Number(current.notificationDeliveryAttemptCount || 0)
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
    const ownerRef = database.collection('notificationTokenOwners')
      .doc(tokenOwnerId(subscription.token))
    const [snapshot, ownerSnapshot] = await Promise.all([
      transaction.get(subscription.deviceRef),
      transaction.get(ownerRef),
    ])
    if (!snapshot.exists) return false
    const current = snapshot.data()
    const validSubscription = subscription.legacy
      ? current.notificationsEnabled === true
        && current.fcmToken === subscription.token
        && !ownerSnapshot.exists
      : current.enabled === true
        && current.token === subscription.token
        && ownerSnapshot.exists
        && ownerSnapshot.data().uid === subscription.userRef.id
        && ownerSnapshot.data().deviceId === subscription.deviceId
    if (!validSubscription) return false
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
