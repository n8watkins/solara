const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  MAX_NOTIFICATION_DEVICES,
  MAX_REGISTRATIONS_PER_MINUTE,
  registerNotificationDevice,
  removeNotificationDevice,
  tokenOwnerId,
} = require('../lib/notification-devices')

const DEVICE_ID = 'a'.repeat(36)
const TOKEN = 'token-'.padEnd(24, 'x')

function fakeDb({
  activeDeviceCount = 0,
  existingDeviceData = null,
  legacyTokenOwners = [],
  legacyTokenOwnerData = {},
  owner = null,
  registrationLimit = null,
  priorDeviceData = null,
  tier = 'paid',
  accountDeletionStartedAt = null,
} = {}) {
  const writes = []
  const deletes = []
  const ref = (kind, id, uid) => ({ kind, id, uid })
  const userRef = uid => ({
    ...ref('user', uid, uid),
    collection: () => ({
      doc: id => ref('device', id, uid),
      where: () => ({ limit: () => ref('device-query', 'enabled', uid) }),
    }),
  })
  const db = {
    writes,
    deletes,
    collection(name) {
      if (name === 'users') {
        return {
          doc: userRef,
          where: (field, operator, value) => ({
            kind: 'legacy-query',
            field,
            operator,
            value,
          }),
        }
      }
      if (name === 'notificationTokenOwners') {
        return { doc: id => ref('owner', id) }
      }
      if (name === 'notificationRegistrationLimits') return { doc: id => ref('limit', id, id) }
      throw new Error(`Unexpected collection ${name}`)
    },
    async runTransaction(callback) {
      await callback({
        async get(ref) {
          if (ref.kind === 'user') {
            return { exists: true, data: () => ({ tier, accountDeletionStartedAt }) }
          }
          if (ref.kind === 'device') {
            const data = ref.uid === 'alice' && ref.id === DEVICE_ID
              ? existingDeviceData
              : priorDeviceData
            return { exists: !!data, data: () => data }
          }
          if (ref.kind === 'device-query') return { size: activeDeviceCount }
          if (ref.kind === 'legacy-query') {
            assert.equal(ref.field, 'fcmToken')
            assert.equal(ref.operator, '==')
            assert.equal(ref.value, TOKEN)
            return {
              docs: legacyTokenOwners.map(uid => ({
                id: uid,
                ref: userRef(uid),
                data: () => legacyTokenOwnerData[uid] || {},
              })),
            }
          }
          if (ref.kind === 'owner') return { exists: !!owner, data: () => owner }
          if (ref.kind === 'limit') {
            return { exists: !!registrationLimit, data: () => registrationLimit }
          }
          throw new Error('Unexpected transaction read')
        },
        set(ref, data, options) { writes.push({ ref, data, options }) },
        delete(ref) { deletes.push(ref) },
      })
    },
  }
  return db
}

function request(body, authorization = 'Bearer valid') {
  return {
    body,
    headers: { authorization, 'x-firebase-appcheck': 'valid-app-check-token' },
  }
}

const auth = { verifyIdToken: async () => ({ uid: 'alice' }) }
const appCheck = { verifyToken: async () => ({ appId: 'test-app' }) }

describe('notification device mutations', () => {
  test('requires a valid App Check token', async () => {
    await assert.rejects(registerNotificationDevice({
      appCheck,
      auth,
      db: fakeDb(),
      req: { body: { deviceId: DEVICE_ID, platform: 'web', token: TOKEN }, headers: {} },
      serverTimestamp: () => 'server-time',
    }), error => error.status === 401)
  })

  test('registers a valid device for a paid account', async () => {
    const db = fakeDb()
    const result = await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    assert.deepEqual(result, { deviceId: DEVICE_ID, registered: true })
    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.deepEqual(deviceWrite.data, {
      token: TOKEN,
      enabled: true,
      platform: 'web',
      createdAt: 'server-time',
      updatedAt: 'server-time',
    })
    assert.deepEqual(
      db.writes.find(write => write.ref.kind === 'owner').data,
      { uid: 'alice', deviceId: DEVICE_ID, updatedAt: 'server-time' },
    )
    assert.deepEqual(
      db.writes.find(write => write.ref.kind === 'user').data,
      { fcmToken: null, notificationsEnabled: false },
    )
  })

  test('preserves delivery state when a device token rotates', async () => {
    const db = fakeDb({
      existingDeviceData: {
        enabled: true,
        token: 'old-token'.padEnd(24, 'x'),
        lastNotificationKey: 'daily-v2:2026-07-14',
        notificationDeliveryStatus: 'delivered',
      },
    })
    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })
    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(deviceWrite.data.lastNotificationKey, 'daily-v2:2026-07-14')
    assert.equal(deviceWrite.data.notificationDeliveryStatus, 'delivered')
    assert.equal(deviceWrite.data.notificationDeliveryAttemptId, null)
  })

  test('rejects free accounts and invalid device input', async () => {
    await assert.rejects(
      registerNotificationDevice({
        appCheck,
        auth,
        db: fakeDb({ tier: 'free' }),
        req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 403,
    )
    await assert.rejects(
      registerNotificationDevice({
        appCheck,
        auth,
        db: fakeDb(),
        req: request({ deviceId: '../other-user', platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 400,
    )
  })

  test('rejects registration after account deletion starts', async () => {
    await assert.rejects(
      registerNotificationDevice({
        appCheck,
        auth,
        db: fakeDb({ accountDeletionStartedAt: 'server-time' }),
        req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 409,
    )
  })

  test('throttles repeated registration attempts per account', async () => {
    await assert.rejects(registerNotificationDevice({
      appCheck,
      auth,
      db: fakeDb({
        registrationLimit: { count: MAX_REGISTRATIONS_PER_MINUTE, windowStartedAt: 1_000 },
      }),
      nowMs: 30_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }), error => error.status === 429)

    const db = fakeDb({
      registrationLimit: { count: MAX_REGISTRATIONS_PER_MINUTE, windowStartedAt: 1_000 },
    })
    await assert.doesNotReject(registerNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 61_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }))
    assert.deepEqual(db.writes.find(write => write.ref.kind === 'limit').data, {
      count: 1,
      windowStartedAt: 61_000,
      updatedAt: 'server-time',
    })
  })

  test('enforces the cap while allowing an existing device to refresh', async () => {
    await assert.rejects(
      registerNotificationDevice({
        appCheck,
        auth,
        db: fakeDb({ activeDeviceCount: MAX_NOTIFICATION_DEVICES }),
        req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 409,
    )

    const db = fakeDb({
      activeDeviceCount: MAX_NOTIFICATION_DEVICES,
      existingDeviceData: { enabled: true, token: TOKEN },
    })
    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })
    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(Object.hasOwn(deviceWrite.data, 'createdAt'), false)
  })

  test('ignores disabled records when enforcing the active device cap', async () => {
    const db = fakeDb({ activeDeviceCount: MAX_NOTIFICATION_DEVICES - 1 })
    await assert.doesNotReject(registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }))
  })

  test('transfers a token away from its previous account device', async () => {
    const db = fakeDb({
      owner: { uid: 'bob', deviceId: 'b'.repeat(36), token: TOKEN },
      priorDeviceData: { enabled: true, token: TOKEN },
    })
    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    assert.equal(db.deletes.some(ref => ref.kind === 'device' && ref.uid === 'bob'), true)
    assert.equal(db.writes.find(write => write.ref.kind === 'owner').ref.id, tokenOwnerId(TOKEN))
  })

  test('does not transfer a token during an active delivery claim', async () => {
    const db = fakeDb({
      owner: { uid: 'bob', deviceId: 'b'.repeat(36), token: TOKEN },
      priorDeviceData: {
        enabled: true,
        token: TOKEN,
        notificationDeliveryStatus: 'claimed',
        notificationDeliveryClaimedAt: new Date(1_000),
      },
    })
    await assert.rejects(registerNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 2_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }), error => error.status === 409)
    assert.equal(db.writes.length, 0)
  })

  test('preserves ambiguous delivery state when transferring a token', async () => {
    const claimedAt = new Date(1_000)
    const db = fakeDb({
      owner: { uid: 'bob', deviceId: 'b'.repeat(36), token: TOKEN },
      priorDeviceData: {
        enabled: true,
        token: TOKEN,
        notificationDeliveryKey: 'daily-v2:2026-07-14',
        notificationDeliveryStatus: 'unknown',
        notificationDeliveryAttemptId: 'attempt-1',
        notificationDeliveryClaimedAt: claimedAt,
      },
    })

    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 2_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(deviceWrite.data.notificationDeliveryKey, 'daily-v2:2026-07-14')
    assert.equal(deviceWrite.data.notificationDeliveryStatus, 'unknown')
    assert.equal(deviceWrite.data.notificationDeliveryAttemptId, 'attempt-1')
    assert.equal(deviceWrite.data.notificationDeliveryClaimedAt, claimedAt)
  })

  test('does not transfer a legacy token during an active delivery claim', async () => {
    const db = fakeDb({
      legacyTokenOwners: ['bob'],
      legacyTokenOwnerData: {
        bob: {
          notificationDeliveryStatus: 'claimed',
          notificationDeliveryClaimedAt: new Date(1_000),
        },
      },
    })
    await assert.rejects(registerNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 2_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }), error => error.status === 409)
    assert.equal(db.writes.length, 0)
  })

  test('does not migrate the authenticated legacy token during an active delivery claim', async () => {
    const db = fakeDb({
      legacyTokenOwners: ['alice'],
      legacyTokenOwnerData: {
        alice: {
          notificationDeliveryStatus: 'claimed',
          notificationDeliveryClaimedAt: new Date(1_000),
        },
      },
    })
    await assert.rejects(registerNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 2_000,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    }), error => error.status === 409)
    assert.equal(db.writes.length, 0)
  })

  test('preserves legacy delivery state when migrating a token', async () => {
    const db = fakeDb({
      legacyTokenOwners: ['alice'],
      legacyTokenOwnerData: {
        alice: {
          lastNotificationKey: 'daily-v2:2026-07-14',
          notificationDeliveryKey: 'daily-v2:2026-07-14',
          notificationDeliveryStatus: 'unknown',
          notificationDeliveryAttemptId: 'attempt-1',
        },
      },
    })
    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(deviceWrite.data.lastNotificationKey, 'daily-v2:2026-07-14')
    assert.equal(deviceWrite.data.notificationDeliveryStatus, 'unknown')
    assert.equal(deviceWrite.data.notificationDeliveryAttemptId, 'attempt-1')
  })

  test('preserves a same-day ambiguous delivery across duplicate legacy records', async () => {
    const db = fakeDb({
      legacyTokenOwners: ['bob', 'carol'],
      legacyTokenOwnerData: {
        bob: {
          notificationDeliveryKey: 'daily-v2:2026-07-14',
          notificationDeliveryStatus: 'unknown',
          notificationDeliveryAttemptId: 'ambiguous-attempt',
          notificationDeliveryUpdatedAt: new Date(1_000),
        },
        carol: {
          notificationDeliveryKey: 'daily-v2:2026-07-14',
          notificationDeliveryStatus: 'failed',
          notificationDeliveryAttemptId: 'definite-failure',
          notificationDeliveryError: 'old failure',
          notificationDeliveryUpdatedAt: new Date(2_000),
        },
      },
    })

    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(deviceWrite.data.notificationDeliveryStatus, 'unknown')
    assert.equal(deviceWrite.data.notificationDeliveryAttemptId, 'ambiguous-attempt')
    assert.equal(deviceWrite.data.notificationDeliveryError, null)
  })

  test('selects the newest delivery record without mixing older fields', async () => {
    const db = fakeDb({
      existingDeviceData: {
        token: 'old-token'.padEnd(24, 'x'),
        notificationDeliveryKey: 'daily-v2:2026-07-13',
        notificationDeliveryStatus: 'unknown',
        notificationDeliveryAttemptId: 'older-attempt',
        notificationDeliveryUpdatedAt: new Date(3_000),
      },
      legacyTokenOwners: ['alice'],
      legacyTokenOwnerData: {
        alice: {
          notificationDeliveryKey: 'daily-v2:2026-07-14',
          notificationDeliveryStatus: 'failed',
          notificationDeliveryError: 'definite failure',
          notificationDeliveryUpdatedAt: new Date(1_000),
        },
      },
    })

    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    const deviceWrite = db.writes.find(write => write.ref.kind === 'device')
    assert.equal(deviceWrite.data.notificationDeliveryKey, 'daily-v2:2026-07-14')
    assert.equal(deviceWrite.data.notificationDeliveryStatus, 'failed')
    assert.equal(deviceWrite.data.notificationDeliveryError, 'definite failure')
    assert.equal(deviceWrite.data.notificationDeliveryAttemptId, null)
  })

  test('clears every legacy account that still holds a transferred token', async () => {
    const db = fakeDb({ legacyTokenOwners: ['alice', 'bob', 'carol'] })
    await registerNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    const clearedUsers = db.writes
      .filter(write => write.ref.kind === 'user')
      .map(write => write.ref.uid)
      .sort()
    assert.deepEqual(clearedUsers, ['alice', 'bob', 'carol'])
    for (const write of db.writes.filter(write => write.ref.kind === 'user')) {
      assert.deepEqual(write.data, { fcmToken: null, notificationsEnabled: false })
    }
  })

  test('removes only the authenticated account device', async () => {
    const db = fakeDb({
      tier: 'free',
      existingDeviceData: { enabled: true, token: TOKEN },
      owner: { uid: 'alice', deviceId: DEVICE_ID, token: TOKEN },
    })
    const result = await removeNotificationDevice({
      appCheck,
      auth,
      db,
      req: request({ deviceId: DEVICE_ID }),
    })
    assert.deepEqual(result, { deviceId: DEVICE_ID, removed: true })
    assert.equal(db.deletes.some(ref => ref.kind === 'device' && ref.uid === 'alice'), true)
    assert.equal(db.deletes.some(ref => ref.kind === 'owner'), true)
  })

  test('does not remove a device during an active delivery claim', async () => {
    const db = fakeDb({
      existingDeviceData: {
        enabled: true,
        token: TOKEN,
        notificationDeliveryStatus: 'claimed',
        notificationDeliveryClaimedAt: new Date(1_000),
      },
      owner: { uid: 'alice', deviceId: DEVICE_ID },
    })
    await assert.rejects(removeNotificationDevice({
      appCheck,
      auth,
      db,
      nowMs: 2_000,
      req: request({ deviceId: DEVICE_ID }),
    }), error => error.status === 409)
    assert.equal(db.deletes.length, 0)
  })
})
