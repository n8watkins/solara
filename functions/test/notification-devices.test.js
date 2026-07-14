const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  MAX_NOTIFICATION_DEVICES,
  registerNotificationDevice,
  removeNotificationDevice,
} = require('../lib/notification-devices')

const DEVICE_ID = 'a'.repeat(36)
const TOKEN = 'token-'.padEnd(24, 'x')

function fakeDb({ deviceCount = 0, existingDevice = false, tier = 'paid' } = {}) {
  const writes = []
  const deletes = []
  const deviceRef = { kind: 'device', id: DEVICE_ID, async delete() { deletes.push(DEVICE_ID) } }
  const devicesCollection = {
    doc: () => deviceRef,
    limit: () => ({ kind: 'device-query' }),
  }
  const userRef = {
    kind: 'user',
    collection: () => devicesCollection,
  }
  const db = {
    writes,
    deletes,
    collection: () => ({ doc: () => userRef }),
    async runTransaction(callback) {
      await callback({
        async get(ref) {
          if (ref.kind === 'user') return { exists: true, data: () => ({ tier }) }
          if (ref.kind === 'device') return { exists: existingDevice }
          if (ref.kind === 'device-query') return { size: deviceCount }
          throw new Error('Unexpected transaction read')
        },
        set(ref, data, options) { writes.push({ ref, data, options }) },
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
    assert.equal(db.writes.length, 1)
    assert.deepEqual(db.writes[0].data, {
      token: TOKEN,
      enabled: true,
      platform: 'web',
      createdAt: 'server-time',
      updatedAt: 'server-time',
    })
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
        db: fakeDb({ deviceCount: MAX_NOTIFICATION_DEVICES }),
        req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
        serverTimestamp: () => 'server-time',
      }),
      error => error.status === 409,
    )

    const db = fakeDb({ deviceCount: MAX_NOTIFICATION_DEVICES, existingDevice: true })
    await registerNotificationDevice({
      auth,
      db,
      req: request({ deviceId: DEVICE_ID, platform: 'web', token: TOKEN }),
      serverTimestamp: () => 'server-time',
    })
    assert.equal(db.writes.length, 1)
    assert.equal(Object.hasOwn(db.writes[0].data, 'createdAt'), false)
  })

  test('removes only the authenticated account device', async () => {
    const db = fakeDb({ tier: 'free' })
    const result = await removeNotificationDevice({
      auth,
      db,
      req: request({ deviceId: DEVICE_ID }),
    })
    assert.deepEqual(result, { deviceId: DEVICE_ID, removed: true })
    assert.deepEqual(db.deletes, [DEVICE_ID])
  })
})
