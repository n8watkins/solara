const { authenticate } = require('./account')

const MAX_NOTIFICATION_DEVICES = 5
const DEVICE_ID_PATTERN = /^[a-f0-9]{36}$/
const PLATFORMS = new Set(['web', 'ios', 'android'])

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

async function registerNotificationDevice({ auth, db, req, serverTimestamp }) {
  const identity = await authenticate(auth, req.headers.authorization)
  const device = parseDevice(req.body, { requireToken: true })
  const userRef = db.collection('users').doc(identity.uid)
  const deviceRef = userRef.collection('notificationDevices').doc(device.deviceId)

  await db.runTransaction(async transaction => {
    const [userSnapshot, deviceSnapshot, devicesSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(deviceRef),
      transaction.get(userRef.collection('notificationDevices').limit(MAX_NOTIFICATION_DEVICES + 1)),
    ])
    if (!userSnapshot.exists || userSnapshot.data().tier !== 'paid') {
      throw httpError('A paid subscription is required', 403)
    }
    if (!deviceSnapshot.exists && devicesSnapshot.size >= MAX_NOTIFICATION_DEVICES) {
      throw httpError('Notification device limit reached', 409)
    }

    transaction.set(deviceRef, {
      token: device.token,
      enabled: true,
      platform: device.platform,
      ...(deviceSnapshot.exists ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  })

  return { deviceId: device.deviceId, registered: true }
}

async function removeNotificationDevice({ auth, db, req }) {
  const identity = await authenticate(auth, req.headers.authorization)
  const { deviceId } = parseDevice(req.body, { requireToken: false })
  await db.collection('users').doc(identity.uid)
    .collection('notificationDevices').doc(deviceId).delete()
  return { deviceId, removed: true }
}

module.exports = {
  MAX_NOTIFICATION_DEVICES,
  parseDevice,
  registerNotificationDevice,
  removeNotificationDevice,
}
