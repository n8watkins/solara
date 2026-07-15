const { authenticate } = require('./account')
const { createHash, randomUUID } = require('node:crypto')

const MAX_NOTIFICATION_DEVICES = 5
const MAX_REGISTRATIONS_PER_MINUTE = 10
const LEGACY_MIGRATION_PAGE_SIZE = 100
const NOTIFICATION_CLAIM_LEASE_MS = 12 * 60 * 1000
const DEVICE_ID_PATTERN = /^[a-f0-9]{36}$/
const PLATFORMS = new Set(['web', 'ios', 'android'])
const PROTECTIVE_DELIVERY_STATUSES = new Set(['claimed', 'delivered', 'unknown'])
const DELIVERED_HISTORY_FIELDS = [
  'lastDeliveredAt',
  'lastNotificationKey',
]
const DELIVERY_ATTEMPT_FIELDS = [
  'notificationDeliveryKey',
  'notificationDeliveryStatus',
  'notificationDeliveryAttemptId',
  'notificationDeliveryAttemptCount',
  'notificationDeliveryClaimedAt',
  'notificationDeliveryCompletedAt',
  'notificationDeliveryError',
  'notificationDeliveryErrorAt',
  'notificationDeliveryRunId',
  'notificationDeliveryUpdatedAt',
  'lastError',
]
const DELIVERY_STATE_FIELDS = [...DELIVERED_HISTORY_FIELDS, ...DELIVERY_ATTEMPT_FIELDS]

function httpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseDevice(input, { requireToken }) {
  const deviceId = input?.deviceId
  if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw httpError('Invalid device identifier', 400)
  }

  if (!requireToken) return { deviceId }

  const token = input?.token
  const platform = input?.platform
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    throw httpError('Invalid notification token', 400)
  }
  if (!PLATFORMS.has(platform)) throw httpError('Invalid device platform', 400)
  return { deviceId, platform, token }
}

function tokenOwnerId(token) {
  return createHash('sha256').update(token).digest('hex')
}

function activeDeliveryClaim(data, nowMs) {
  if (data?.notificationDeliveryStatus !== 'claimed') return false
  const claimedAt = data.notificationDeliveryClaimedAt
  const claimedAtMs = claimedAt instanceof Date
    ? claimedAt.getTime()
    : claimedAt && typeof claimedAt.toMillis === 'function'
      ? claimedAt.toMillis()
      : NaN
  return Number.isFinite(claimedAtMs) && nowMs - claimedAtMs < NOTIFICATION_CLAIM_LEASE_MS
}

function deliveryState(data) {
  return Object.fromEntries(DELIVERY_STATE_FIELDS
    .filter(field => Object.hasOwn(data || {}, field))
    .map(field => [field, data[field]]))
}

function timestampMillis(value) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return Number.NEGATIVE_INFINITY
}

function notificationDay(key) {
  const match = typeof key === 'string' && key.match(/^daily-v\d+:(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return Number.NEGATIVE_INFINITY
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const date = Number(match[3])
  const day = new Date(Date.UTC(year, month, date))
  return day.getUTCFullYear() === year && day.getUTCMonth() === month && day.getUTCDate() === date
    ? day.getTime()
    : Number.NEGATIVE_INFINITY
}

function selectNewestState(states, metadata) {
  return states.reduce((selected, candidate) => {
    if (!selected) return candidate
    const current = metadata(selected)
    const next = metadata(candidate)
    if (next.day !== current.day) return next.day > current.day ? candidate : selected
    if (next.protective !== current.protective) return next.protective ? candidate : selected
    if (next.updatedAt !== current.updatedAt) {
      return next.updatedAt > current.updatedAt ? candidate : selected
    }
    return Object.keys(candidate).length > Object.keys(selected).length ? candidate : selected
  }, null)
}

function attemptMetadata(state) {
  const updatedAt = Math.max(
    timestampMillis(state.notificationDeliveryUpdatedAt),
    timestampMillis(state.notificationDeliveryCompletedAt),
    timestampMillis(state.notificationDeliveryErrorAt),
    timestampMillis(state.notificationDeliveryClaimedAt),
  )
  return {
    day: notificationDay(state.notificationDeliveryKey),
    protective: PROTECTIVE_DELIVERY_STATUSES.has(state.notificationDeliveryStatus),
    updatedAt,
  }
}

function mergeDeliveryStates(sources) {
  const states = sources.map(deliveryState)
  const histories = states.map(state => Object.fromEntries(DELIVERED_HISTORY_FIELDS
    .filter(field => Object.hasOwn(state, field))
    .map(field => [field, state[field]])))
    .filter(state => Object.keys(state).length > 0)
  const attempts = states.map(state => Object.fromEntries(DELIVERY_ATTEMPT_FIELDS
    .filter(field => Object.hasOwn(state, field))
    .map(field => [field, state[field]])))
    .filter(state => Object.keys(state).length > 0)
  const history = selectNewestState(histories, state => ({
    day: notificationDay(state.lastNotificationKey),
    protective: Number.isFinite(notificationDay(state.lastNotificationKey)),
    updatedAt: timestampMillis(state.lastDeliveredAt),
  }))
  const attempt = selectNewestState(attempts, attemptMetadata)
  return {
    ...(history ? {
      ...Object.fromEntries(DELIVERED_HISTORY_FIELDS.map(field => [field, null])),
      ...history,
    } : {}),
    ...(attempt ? {
      ...Object.fromEntries(DELIVERY_ATTEMPT_FIELDS.map(field => [field, null])),
      ...attempt,
    } : {}),
  }
}

async function authenticateApp(appCheck, token) {
  if (typeof token !== 'string' || !token) throw httpError('App verification required', 401)
  try {
    await appCheck.verifyToken(token)
  } catch {
    throw httpError('App verification required', 401)
  }
}

async function registerNotificationDevice({ appCheck, auth, db, req, serverTimestamp, nowMs = Date.now() }) {
  await authenticateApp(appCheck, req.headers['x-firebase-appcheck'])
  const identity = await authenticate(auth, req.headers.authorization)
  const device = parseDevice(req.body, { requireToken: true })
  const userRef = db.collection('users').doc(identity.uid)
  const deviceRef = userRef.collection('notificationDevices').doc(device.deviceId)
  const ownerRef = db.collection('notificationTokenOwners').doc(tokenOwnerId(device.token))
  const limitRef = db.collection('notificationRegistrationLimits').doc(identity.uid)
  const migrationId = randomUUID()

  await db.runTransaction(async transaction => {
    const [
      userSnapshot,
      deviceSnapshot,
      devicesSnapshot,
      ownerSnapshot,
      limitSnapshot,
    ] = await Promise.all([
      transaction.get(userRef),
      transaction.get(deviceRef),
      transaction.get(userRef.collection('notificationDevices')
        .where('enabled', '==', true).limit(MAX_NOTIFICATION_DEVICES + 1)),
      transaction.get(ownerRef),
      transaction.get(limitRef),
    ])
    if (userSnapshot.exists && userSnapshot.data().accountDeletionStartedAt) {
      throw httpError('Account deletion is in progress', 409)
    }
    if (!userSnapshot.exists || userSnapshot.data().tier !== 'paid') {
      throw httpError('A paid subscription is required', 403)
    }

    const limit = limitSnapshot.exists ? limitSnapshot.data() : null
    const windowStartedAt = Number.isFinite(limit?.windowStartedAt) ? limit.windowStartedAt : nowMs
    const withinWindow = nowMs - windowStartedAt < 60_000
    const registrationCount = withinWindow && Number.isFinite(limit?.count) ? limit.count : 0
    if (registrationCount >= MAX_REGISTRATIONS_PER_MINUTE) {
      throw httpError('Too many notification registration attempts', 429)
    }

    const current = deviceSnapshot.exists ? deviceSnapshot.data() : null
    const priorOwner = ownerSnapshot.exists ? ownerSnapshot.data() : null
    const priorDeviceRef = priorOwner
      && (priorOwner.uid !== identity.uid || priorOwner.deviceId !== device.deviceId)
      ? db.collection('users').doc(priorOwner.uid)
        .collection('notificationDevices').doc(priorOwner.deviceId)
      : null
    const oldOwnerRef = current?.token && current.token !== device.token
      ? db.collection('notificationTokenOwners').doc(tokenOwnerId(current.token))
      : null
    const [priorDeviceSnapshot, oldOwnerSnapshot] = await Promise.all([
      priorDeviceRef ? transaction.get(priorDeviceRef) : null,
      oldOwnerRef ? transaction.get(oldOwnerRef) : null,
    ])
    if (priorDeviceRef && activeDeliveryClaim(priorDeviceSnapshot?.data(), nowMs)) {
      throw httpError('Notification delivery is in progress', 409)
    }
    if (current?.token !== device.token && activeDeliveryClaim(current, nowMs)) {
      throw httpError('Notification delivery is in progress', 409)
    }
    const reclaimsActiveSlot = priorOwner?.uid === identity.uid
      && priorDeviceSnapshot?.exists
      && priorDeviceSnapshot.data().enabled === true
      && priorDeviceSnapshot.data().token === device.token
    const projectedActiveDevices = devicesSnapshot.size
      + (current?.enabled === true ? 0 : 1)
      - (reclaimsActiveSlot ? 1 : 0)
    if (projectedActiveDevices > MAX_NOTIFICATION_DEVICES) {
      throw httpError('Notification device limit reached', 409)
    }

    if (priorDeviceRef && priorDeviceSnapshot?.exists
      && priorDeviceSnapshot.data().token === device.token) {
      transaction.delete(priorDeviceRef)
    }
    if (oldOwnerRef && oldOwnerSnapshot?.exists) {
      const oldOwner = oldOwnerSnapshot.data()
      if (oldOwner.uid === identity.uid && oldOwner.deviceId === device.deviceId) {
        transaction.delete(oldOwnerRef)
      }
    }
    const transferredDeliveryState = mergeDeliveryStates([
      current,
      priorDeviceSnapshot?.exists && priorDeviceSnapshot.data().token === device.token
        ? priorDeviceSnapshot.data()
        : null,
    ])
    transaction.set(deviceRef, {
      token: device.token,
      enabled: true,
      platform: device.platform,
      registrationMigrationId: migrationId,
      ...transferredDeliveryState,
      ...(deviceSnapshot.exists ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true })
    transaction.set(ownerRef, {
      uid: identity.uid,
      deviceId: device.deviceId,
      registrationMigrationId: migrationId,
      updatedAt: serverTimestamp(),
    })
    transaction.set(limitRef, {
      count: registrationCount + 1,
      windowStartedAt: withinWindow ? windowStartedAt : nowMs,
      updatedAt: serverTimestamp(),
    })
  })

  const legacyOwnersQuery = db.collection('users')
    .where('fcmToken', '==', device.token)
    .limit(LEGACY_MIGRATION_PAGE_SIZE)
  let migrationPending = true
  try {
    migrationPending = await db.runTransaction(async transaction => {
      const [deviceSnapshot, ownerSnapshot, legacyOwnersSnapshot] = await Promise.all([
        transaction.get(deviceRef),
        transaction.get(ownerRef),
        transaction.get(legacyOwnersQuery),
      ])
      const current = deviceSnapshot.exists ? deviceSnapshot.data() : null
      const owner = ownerSnapshot.exists ? ownerSnapshot.data() : null
      if (current?.token !== device.token
        || current.registrationMigrationId !== migrationId
        || owner?.uid !== identity.uid
        || owner.deviceId !== device.deviceId
        || owner.registrationMigrationId !== migrationId) {
        throw httpError('Notification registration was superseded', 409)
      }
      const transferredDeliveryState = mergeDeliveryStates([
        current,
        ...legacyOwnersSnapshot.docs.map(legacyOwner => legacyOwner.data()),
      ])
      const pending = legacyOwnersSnapshot.docs.length === LEGACY_MIGRATION_PAGE_SIZE
      transaction.set(deviceRef, {
        ...transferredDeliveryState,
        ...(pending ? {} : { registrationMigrationId: null }),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      if (!pending) {
        transaction.set(ownerRef, {
          uid: identity.uid,
          deviceId: device.deviceId,
          updatedAt: serverTimestamp(),
        })
      }
      for (const legacyOwner of legacyOwnersSnapshot.docs) {
        transaction.set(legacyOwner.ref, {
          fcmToken: null,
          notificationsEnabled: false,
        }, { merge: true })
      }
      return pending
    })
  } catch (error) {
    if (error?.status) throw error
    console.error(JSON.stringify({
      event: 'notification-registration-migration-deferred',
      deviceId: device.deviceId,
      error: error?.message || String(error),
    }))
  }

  return {
    deviceId: device.deviceId,
    registered: true,
    migrationPending,
  }
}

async function removeNotificationDevice({ appCheck, auth, db, req, nowMs = Date.now() }) {
  await authenticateApp(appCheck, req.headers['x-firebase-appcheck'])
  const identity = await authenticate(auth, req.headers.authorization)
  const { deviceId } = parseDevice(req.body, { requireToken: false })
  const deviceRef = db.collection('users').doc(identity.uid)
    .collection('notificationDevices').doc(deviceId)
  await db.runTransaction(async transaction => {
    const deviceSnapshot = await transaction.get(deviceRef)
    if (!deviceSnapshot.exists) return
    if (activeDeliveryClaim(deviceSnapshot.data(), nowMs)) {
      throw httpError('Notification delivery is in progress', 409)
    }
    const token = deviceSnapshot.data().token
    const ownerRef = typeof token === 'string'
      ? db.collection('notificationTokenOwners').doc(tokenOwnerId(token))
      : null
    const ownerSnapshot = ownerRef ? await transaction.get(ownerRef) : null
    transaction.delete(deviceRef)
    if (ownerRef && ownerSnapshot?.exists) {
      const owner = ownerSnapshot.data()
      if (owner.uid === identity.uid && owner.deviceId === deviceId) transaction.delete(ownerRef)
    }
  })
  return { deviceId, removed: true }
}

module.exports = {
  MAX_NOTIFICATION_DEVICES,
  MAX_REGISTRATIONS_PER_MINUTE,
  authenticateApp,
  parseDevice,
  registerNotificationDevice,
  removeNotificationDevice,
  tokenOwnerId,
}
