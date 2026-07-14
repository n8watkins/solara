const SENSITIVE_EXPORT_FIELDS = new Set([
  'calendarFeedToken',
  'fcmToken',
  'stripeCustomerId',
  'stripeSubscriptionId',
])

async function authenticate(auth, authorization, options = {}) {
  const match = (authorization || '').match(/^Bearer (.+)$/)
  if (!match) {
    const error = new Error('Authentication required')
    error.status = 401
    throw error
  }
  let identity
  try {
    identity = await auth.verifyIdToken(match[1], true)
  } catch {
    const error = new Error('Authentication required')
    error.status = 401
    throw error
  }
  if (options.maxAgeSeconds) {
    const authenticatedAt = identity.auth_time
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (!Number.isFinite(authenticatedAt) || nowSeconds - authenticatedAt > options.maxAgeSeconds) {
      const error = new Error('Recent authentication required')
      error.status = 401
      error.code = 'reauth-required'
      throw error
    }
  }
  return identity
}

function safeAccountData(data) {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => !SENSITIVE_EXPORT_FIELDS.has(key)),
  )
}

function safeDeviceData(snapshot) {
  return snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      enabled: data.enabled === true,
      platform: data.platform || 'unknown',
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      lastDeliveredAt: data.lastDeliveredAt || null,
      lastError: data.lastError || null,
    }
  })
}

async function exportAccountData({ auth, db, req }) {
  const identity = await authenticate(auth, req.headers.authorization)
  const userRef = db.collection('users').doc(identity.uid)
  const [userSnapshot, devicesSnapshot] = await Promise.all([
    userRef.get(),
    userRef.collection('notificationDevices').get(),
  ])
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: userSnapshot.exists ? safeAccountData(userSnapshot.data()) : null,
    notificationDevices: safeDeviceData(devicesSnapshot),
  }
}

async function deleteAccount({ auth, db, req, stripe }) {
  const identity = await authenticate(auth, req.headers.authorization, { maxAgeSeconds: 300 })
  if (req.body?.confirmation !== 'DELETE') {
    const error = new Error('Deletion confirmation required')
    error.status = 400
    throw error
  }

  const userRef = db.collection('users').doc(identity.uid)
  const snapshot = await userRef.get()
  const subscriptionId = snapshot.exists ? snapshot.data().stripeSubscriptionId : null
  if (typeof subscriptionId === 'string' && subscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscriptionId)
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error
    }
  }

  await db.recursiveDelete(userRef)
  await auth.deleteUser(identity.uid)
}

module.exports = { authenticate, deleteAccount, exportAccountData, safeAccountData }
