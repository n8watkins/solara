const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  MAX_NOTIFICATION_DEVICES,
  registerNotificationDevice,
  removeNotificationDevice,
  tokenOwnerId,
} = require('../lib/notification-devices')

const DEVICE_ID = 'a'.repeat(36)
const TOKEN = 'token-'.padEnd(24, 'x')

function fakeDb({
  activeDeviceCount = 0,
  existingDeviceData = null,
  owner = null,
  priorDeviceData = null,
  tier = 'paid',
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
      if (name === 'users') return { doc: userRef }
      if (name === 'notificationTokenOwners') {
        return { doc: id => ref('owner', id) }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
    async runTransaction(callback) {
      await callback({
        async get(ref) {
          if (ref.kind === 'user') return { exists: true, data: () => ({ tier }) }
          if (ref.kind === 'device') {
            const data = ref.uid === 'alice' && ref.id === DEVICE_ID
              ? existingDeviceData
              : priorDeviceData
            return { exists: !!data, data: () => data }
          }
          if (ref.kind === 'device-query') return { size: activeDeviceCount }
          if (ref.kind === 'owner') return { exists: !!owner, data: () => owner }
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
  return { body, headers: { authorization } }
}

const auth = { verifyIdToken: async () => ({ uid: 'alice' }) }

describe('notification device mutations', () => {
  test('registers a valid device for a paid account', async () => {
    const db = fakeDb()
    const result = await registerNotificationDevice({
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
      { uid: 'alice', deviceId: DEVICE_ID, token: TOKEN, updatedAt: 'server-time' },
    )
    assert.deepEqual(
      db.writes.find(write => write.ref.kind === 'user').data,
      { fcmToken: null, notificationsEnabled: false },
    )
  })

  test('rejects free accounts and invalid device input', async () => {
    await assert.rejects(
      registerNotificationDevice({
        auth,
        db: fakeDb({ tier: 'free' }),
        req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 403,
    )
    await assert.rejects(
      registerNotificationDevice({
        auth,
        db: fakeDb(),
        req: request({ deviceId: '../other-user', platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 400,
    )
  })

  test('enforces the cap while allowing an existing device to refresh', async () => {
    await assert.rejects(
      registerNotificationDevice({
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
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })

    assert.equal(db.deletes.some(ref => ref.kind === 'device' && ref.uid === 'bob'), true)
    assert.equal(db.writes.find(write => write.ref.kind === 'owner').ref.id, tokenOwnerId(TOKEN))
  })

  test('removes only the authenticated account device', async () => {
    const db = fakeDb({
      tier: 'free',
      existingDeviceData: { enabled: true, token: TOKEN },
      owner: { uid: 'alice', deviceId: DEVICE_ID, token: TOKEN },
    })
    const result = await removeNotificationDevice({
      auth,
      db,
      req: request({ deviceId: DEVICE_ID }),
    })
    assert.deepEqual(result, { deviceId: DEVICE_ID, removed: true })
    assert.equal(db.deletes.some(ref => ref.kind === 'device' && ref.uid === 'alice'), true)
    assert.equal(db.deletes.some(ref => ref.kind === 'owner'), true)
  })
})
