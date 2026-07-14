const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const {
  buildMessage,
  isDue,
  localParts,
  mapLimit,
  notificationKey,
  weatherLabel,
} = require('./notification-core')

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const FORCE_SEND = process.env.FORCE_SEND === '1' || process.env.FORCE_SEND === 'true'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'
const CONCURRENCY = Math.max(1, Number(process.env.NOTIFICATION_CONCURRENCY || 10))

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

let db
let messaging
const forecastCache = new Map()

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

async function sendSubscription(subscription, now) {
  const userSnap = await subscription.userRef.get()
  if (!userSnap.exists) return { outcome: 'skipped', reason: 'missing-user' }
  const user = userSnap.data()
  if (user.tier !== 'paid') return { outcome: 'skipped', reason: 'ineligible-tier' }
  if (!user.location || typeof user.location.lat !== 'number' || typeof user.location.lon !== 'number') {
    return { outcome: 'skipped', reason: 'missing-location' }
  }

  const forecast = await fetchHourly(user.location.lat, user.location.lon)
  const timezone = user.location.timezone || forecast.timezone
  const key = notificationKey(timezone, now)
  if (!key) return { outcome: 'skipped', reason: 'invalid-timezone' }
  if (!DRY_RUN && !FORCE_SEND && !isDue(user, timezone, now)) return { outcome: 'skipped', reason: 'not-due' }
  if (!FORCE_SEND && subscription.lastNotificationKey === key) return { outcome: 'skipped', reason: 'already-sent' }

  const local = localParts(now, timezone)
  const { title, body } = buildMessage(user, forecast.hourly, local?.date)
  if (DRY_RUN) return { outcome: 'dry-run', title, userId: userSnap.id }

  try {
    await messaging.send({
      token: subscription.token,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: `${SITE_URL.replace(/\/$/, '')}/icon-192.png`,
          badge: `${SITE_URL.replace(/\/$/, '')}/icon-192.png`,
          tag: key,
          renotify: false,
          requireInteraction: false,
        },
        fcmOptions: { link: SITE_URL },
      },
    })
    await subscription.deviceRef.set({
      lastNotificationKey: key,
      lastDeliveredAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
    }, { merge: true })
    return { outcome: 'sent', title, userId: userSnap.id }
  } catch (error) {
    if (DEAD_TOKEN_CODES.has(error.code)) {
      const patch = subscription.legacy
        ? { fcmToken: null, notificationsEnabled: false, lastError: error.code }
        : { enabled: false, lastError: error.code, updatedAt: FieldValue.serverTimestamp() }
      await subscription.deviceRef.set(patch, { merge: true })
      return { outcome: 'cleaned', reason: error.code }
    }
    await subscription.deviceRef.set({ lastError: String(error.code || error.message || error).slice(0, 500) }, { merge: true })
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

module.exports = { fetchHourly, loadSubscriptions, sendSubscription }

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1) })
}
