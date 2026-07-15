import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  buildMessage,
  claimDecision,
  deliveryDecision,
  failureCertainty,
  isDue,
  isEligibleUser,
  localParts,
  mapLimit,
  notificationKey,
  runsOnDate,
} = require('../scripts/notification-core')
const {
  claimDelivery,
  finishDelivery,
  notificationScope,
  recordDeliveryFailure,
  scanSubscriptions,
  sendSubscription,
} = require('../scripts/send-notifications')
/* eslint-enable @typescript-eslint/no-require-imports */

const hourly = [
  { hour: 6, uv: 1 },
  { hour: 7, uv: 2 },
  { hour: 8, uv: 5 },
]

async function loadSubscriptions(database: unknown) {
  const subscriptions: Array<{ userRef: { id: string } }> = []
  await scanSubscriptions(database, async (batch: Array<{ userRef: { id: string } }>) => subscriptions.push(...batch))
  return subscriptions
}

function makeDeliveryDatabase(initial: Record<string, unknown>) {
  const state: { data: Record<string, unknown> } = {
    data: { token: 'token'.padEnd(24, 'x'), ...initial },
  }
  const owner = { data: { uid: 'user-1', deviceId: 'device-1' } }
  const database = {
    collection: () => ({ doc: () => ({ kind: 'owner' }) }),
    runTransaction: async (worker: (transaction: {
      get: (ref: { kind?: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      set: (_ref: unknown, patch: Record<string, unknown>) => void
    }) => Promise<unknown>) => worker({
      get: async ref => {
        if (ref.kind === 'owner') return { exists: true, data: () => ({ ...owner.data }) }
        if (ref.kind === 'user') {
          return { exists: true, data: () => ({ tier: 'paid', location: { lat: 1, lon: 2 } }) }
        }
        return { exists: true, data: () => ({ ...state.data }) }
      },
      set: (_ref, patch) => { state.data = { ...state.data, ...patch } },
    }),
  }
  return { database, state }
}

describe('notification scheduling', () => {
  it('uses opaque account-specific delivery scopes', () => {
    expect(notificationScope('user-1')).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(notificationScope('user-1')).toBe(notificationScope('user-1'))
    expect(notificationScope('user-1')).not.toBe(notificationScope('user-2'))
    expect(notificationScope('user-1')).not.toContain('user-1')
  })

  it('evaluates the configured morning hour in the user timezone', () => {
    const now = new Date('2026-07-14T14:15:00Z')
    expect(isDue({ notificationHour: 7 }, 'America/Los_Angeles', now)).toBe(true)
    expect(isDue({ notificationHour: 7 }, 'Pacific/Honolulu', now)).toBe(false)
    expect(notificationKey('America/Los_Angeles', now)).toBe('daily-v2:2026-07-14')
  })

  it('uses the location weekday instead of the runner weekday', () => {
    const now = new Date('2026-07-14T01:00:00Z')
    const losAngeles = localParts(now, 'America/Los_Angeles')
    const tokyo = localParts(now, 'Asia/Tokyo')
    expect(losAngeles?.date).toBe('2026-07-13')
    expect(tokyo?.date).toBe('2026-07-14')
    expect(losAngeles?.weekday).not.toBe(tokyo?.weekday)
  })

  it('respects activity weekday restrictions', () => {
    expect(runsOnDate({ daysOfWeek: [1, 3] }, '2026-07-13')).toBe(true)
    expect(runsOnDate({ daysOfWeek: [1, 3] }, '2026-07-14')).toBe(false)
    expect(runsOnDate({}, '2026-07-14')).toBe(true)
  })

  it('requires a paid user with a complete location', () => {
    expect(isEligibleUser({ tier: 'free', location: { lat: 1, lon: 2 } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1 } })).toBe(false)
    expect(isEligibleUser({
      tier: 'paid',
      location: { lat: 1, lon: 2 },
      accountDeletionStartedAt: new Date(),
    })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1, lon: 2 } })).toBe(true)
    expect(isEligibleUser({ tier: 'paid', location: { lat: Number.NaN, lon: 2 } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 91, lon: 2 } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1, lon: Number.POSITIVE_INFINITY } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1, lon: -181 } })).toBe(false)
  })

  it('preserves same-day idempotency during a forced manual run', () => {
    const now = new Date('2026-07-14T03:00:00Z')
    const first = deliveryDecision({ notificationHour: 7 }, 'America/Los_Angeles', null, { forceSend: true, now })
    expect(first.deliver).toBe(true)
    expect(deliveryDecision({ notificationHour: 7 }, 'America/Los_Angeles', first.key, { forceSend: true, now })).toEqual({
      deliver: false,
      reason: 'already-sent',
      key: first.key,
    })
  })
})

describe('notification ownership', () => {
  function notificationDatabase({
    devices = [],
    legacyUsers = [],
    owners = {},
    quarantineFailurePaths = [],
    transactionOwners = owners,
  }: {
    devices?: Array<{
      deviceId: string
      registrationMigrationId?: string
      token: string
      uid: string
    }>
    legacyUsers?: Array<{ token: string; uid: string }>
    owners?: Record<string, { deviceId: string; registrationMigrationId?: string; uid: string }>
    quarantineFailurePaths?: string[]
    transactionOwners?: Record<string, {
      deviceId: string
      registrationMigrationId?: string
      uid: string
    }>
  }) {
    const writes: Array<{ data: Record<string, unknown>; path: string }> = []
    const dataByPath = new Map<string, Record<string, unknown>>()
    const ref = (path: string, id: string, parent: unknown = null) => ({
      id,
      parent,
      path,
    })
    const userRefs = new Map<string, ReturnType<typeof ref>>()
    const userRef = (uid: string) => {
      if (!userRefs.has(uid)) userRefs.set(uid, ref(`users/${uid}`, uid))
      return userRefs.get(uid)!
    }
    const deviceDocs = devices.map(device => {
      const user = userRef(device.uid)
      const parent = { parent: user }
      const deviceRef = ref(`users/${device.uid}/notificationDevices/${device.deviceId}`, device.deviceId, parent)
      const data = {
        enabled: true,
        token: device.token,
        ...(device.registrationMigrationId
          ? { registrationMigrationId: device.registrationMigrationId }
          : {}),
      }
      dataByPath.set(deviceRef.path, data)
      return {
        id: device.deviceId,
        ref: deviceRef,
        data: () => data,
      }
    })
    const legacyDocs = legacyUsers.map(user => {
      const legacyRef = userRef(user.uid)
      const data = { fcmToken: user.token, notificationsEnabled: true }
      dataByPath.set(legacyRef.path, data)
      return { id: user.uid, ref: legacyRef, data: () => data }
    }).sort((left, right) => {
      const tokenOrder = String(left.data().fcmToken).localeCompare(String(right.data().fcmToken))
      return tokenOrder || left.id.localeCompare(right.id)
    })
    type QueryDoc = (typeof deviceDocs)[number] | (typeof legacyDocs)[number]
    const query = (docs: QueryDoc[], start = 0, pageSize = docs.length) => ({
      where: () => query(docs, start, pageSize),
      orderBy: () => query(docs, start, pageSize),
      startAfter: (...cursor: Array<QueryDoc | string>) => {
        const index = cursor.length === 1
          ? docs.findIndex(doc => doc.ref.path === cursor[0])
          : docs.findIndex(doc => {
              const data = doc.data()
              return 'fcmToken' in data && data.fcmToken === cursor[0] && doc.id === cursor[1]
            })
        return query(docs, index + 1, pageSize)
      },
      limit: (limit: number) => query(docs, start, limit),
      get: async () => ({ docs: docs.slice(start, start + pageSize) }),
    })
    return {
      database: {
        collectionGroup: () => query(deviceDocs),
        collection: (name: string) => {
          if (name === 'users') return { ...query(legacyDocs), doc: (uid: string) => userRef(uid) }
          if (name === 'notificationTokenOwners') {
            return { doc: (id: string) => ({ id, kind: 'owner', owner: owners[id] }) }
          }
          throw new Error(`Unexpected collection ${name}`)
        },
        getAll: async (...ownerRefs: Array<{ owner?: { deviceId: string; uid: string } }>) => ownerRefs.map(ownerRef => ({
          exists: !!ownerRef.owner,
          data: () => ownerRef.owner,
        })),
        runTransaction: async (worker: (transaction: {
          get: (target: { id: string; kind?: string; path?: string }) => Promise<{
            exists: boolean
            data: () => Record<string, unknown>
          }>
          set: (target: { path: string }, data: Record<string, unknown>) => void
        }) => Promise<unknown>) => worker({
          get: async target => {
            if (target.kind === 'owner') {
              const owner = transactionOwners[target.id]
              return { exists: !!owner, data: () => owner }
            }
            if (quarantineFailurePaths.includes(target.path || '')) {
              throw new Error('quarantine unavailable')
            }
            const data = dataByPath.get(target.path || '')
            return { exists: !!data, data: () => data || {} }
          },
          set: (target, data) => { writes.push({ data, path: target.path }) },
        }),
      },
      writes,
    }
  }

  it('dispatches only to the canonical owner and quarantines stale claims', async () => {
    const token = 'shared-token'.padEnd(24, 'x')
    const ownerId = createHash('sha256').update(token).digest('hex')
    const { database, writes } = notificationDatabase({
      devices: [
        { deviceId: 'device-alice', token, uid: 'alice' },
        { deviceId: 'device-bob', token, uid: 'bob' },
      ],
      legacyUsers: [{ token, uid: 'carol' }],
      owners: { [ownerId]: { uid: 'bob', deviceId: 'device-bob' } },
    })

    const subscriptions = await loadSubscriptions(database)

    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0].userRef.id).toBe('bob')
    expect(writes.map(write => write.path).sort()).toEqual([
      'users/alice/notificationDevices/device-alice',
      'users/carol',
    ])
  })

  it('does not dispatch a device until legacy migration completes', async () => {
    const token = 'migrating-token'.padEnd(24, 'x')
    const ownerId = createHash('sha256').update(token).digest('hex')
    const { database, writes } = notificationDatabase({
      devices: [{
        deviceId: 'device-alice',
        registrationMigrationId: 'migration-1',
        token,
        uid: 'alice',
      }],
      legacyUsers: [{ token, uid: 'legacy-alice' }],
      owners: {
        [ownerId]: {
          uid: 'alice',
          deviceId: 'device-alice',
          registrationMigrationId: 'migration-1',
        },
      },
    })

    expect(await loadSubscriptions(database)).toEqual([])
    expect(writes).toEqual([])
  })

  it('keeps one legacy claim but quarantines ambiguous legacy ownership', async () => {
    const unique = 'unique-token'.padEnd(24, 'x')
    const shared = 'shared-token'.padEnd(24, 'x')
    const { database, writes } = notificationDatabase({
      legacyUsers: [
        { token: unique, uid: 'alice' },
        { token: shared, uid: 'bob' },
        { token: shared, uid: 'carol' },
      ],
    })

    const subscriptions = await loadSubscriptions(database)

    expect(subscriptions.map((subscription: { userRef: { id: string } }) => subscription.userRef.id)).toEqual(['alice'])
    expect(writes.map(write => write.path).sort()).toEqual(['users/bob', 'users/carol'])
  })

  it('does not quarantine a device that became the canonical owner', async () => {
    const token = 'shared-token'.padEnd(24, 'x')
    const ownerId = createHash('sha256').update(token).digest('hex')
    const { database, writes } = notificationDatabase({
      devices: [
        { deviceId: 'device-alice', token, uid: 'alice' },
        { deviceId: 'device-bob', token, uid: 'bob' },
      ],
      owners: { [ownerId]: { uid: 'bob', deviceId: 'device-bob' } },
      transactionOwners: { [ownerId]: { uid: 'alice', deviceId: 'device-alice' } },
    })

    await loadSubscriptions(database)

    expect(writes).toEqual([])
  })

  it('continues dispatch when quarantining a stale device fails', async () => {
    const staleToken = 'stale-token'.padEnd(24, 'x')
    const validToken = 'valid-token'.padEnd(24, 'x')
    const validOwnerId = createHash('sha256').update(validToken).digest('hex')
    const { database, writes } = notificationDatabase({
      devices: [
        { deviceId: 'device-stale', token: staleToken, uid: 'stale' },
        { deviceId: 'device-valid', token: validToken, uid: 'valid' },
      ],
      owners: { [validOwnerId]: { uid: 'valid', deviceId: 'device-valid' } },
      quarantineFailurePaths: ['users/stale/notificationDevices/device-stale'],
    })
    const consoleError = console.error
    console.error = () => {}

    try {
      const subscriptions: Array<{ userRef: { id: string } }> = []
      await scanSubscriptions(
        database,
        async (batch: Array<{ userRef: { id: string } }>) => subscriptions.push(...batch),
        1,
      )
      expect(subscriptions.map(subscription => subscription.userRef.id)).toEqual(['valid'])
      expect(writes).toEqual([])
    } finally {
      console.error = consoleError
    }
  })

  it('pages subscriptions and preserves duplicate detection across page boundaries', async () => {
    const shared = 'shared-token'.padEnd(24, 'x')
    const deviceTokens = Array.from({ length: 5 }, (_, index) => `device-token-${index}`.padEnd(24, 'x'))
    const owners = Object.fromEntries(deviceTokens.map((token, index) => [
      createHash('sha256').update(token).digest('hex'),
      { uid: `device-user-${index}`, deviceId: `device-${index}` },
    ]))
    const { database, writes } = notificationDatabase({
      devices: deviceTokens.map((token, index) => ({
        deviceId: `device-${index}`,
        token,
        uid: `device-user-${index}`,
      })),
      legacyUsers: [
        { token: 'first-token'.padEnd(24, 'x'), uid: 'legacy-first' },
        { token: shared, uid: 'legacy-shared-a' },
        { token: shared, uid: 'legacy-shared-b' },
        { token: 'z-token'.padEnd(24, 'x'), uid: 'legacy-last' },
      ],
      owners,
    })
    const batches: string[][] = []

    await scanSubscriptions(database, async (subscriptions: Array<{ userRef: { id: string } }>) => {
      batches.push(subscriptions.map(subscription => subscription.userRef.id))
    }, 2, { maxPages: 20 })

    expect(Math.max(...batches.map(batch => batch.length))).toBeLessThanOrEqual(2)
    expect(batches.flat()).toEqual(expect.arrayContaining([
      ...deviceTokens.map((_, index) => `device-user-${index}`),
      'legacy-first',
      'legacy-last',
    ]))
    expect(batches.flat()).not.toContain('legacy-shared-a')
    expect(batches.flat()).not.toContain('legacy-shared-b')
    expect(writes.map(write => write.path).sort()).toEqual([
      'users/legacy-shared-a',
      'users/legacy-shared-b',
    ])
  })

  it('resumes a bounded fair scan from durable cursors', async () => {
    const deviceTokens = Array.from({ length: 3 }, (_, index) => `device-token-${index}`.padEnd(24, 'x'))
    const owners = Object.fromEntries(deviceTokens.map((token, index) => [
      createHash('sha256').update(token).digest('hex'),
      { uid: `device-user-${index}`, deviceId: `device-${index}` },
    ]))
    const { database } = notificationDatabase({
      devices: deviceTokens.map((token, index) => ({
        deviceId: `device-${index}`,
        token,
        uid: `device-user-${index}`,
      })),
      legacyUsers: Array.from({ length: 3 }, (_, index) => ({
        token: `legacy-token-${index}`.padEnd(24, 'x'),
        uid: `legacy-user-${index}`,
      })),
      owners,
    })
    let durableState: Record<string, unknown> = {}
    const stateStore = {
      load: async () => durableState,
      save: async (state: Record<string, unknown>) => { durableState = { ...state } },
    }
    const dispatched: string[] = []

    for (let run = 0; run < 4; run++) {
      const result = await scanSubscriptions(
        database,
        async (batch: Array<{ userRef: { id: string } }>) => {
          dispatched.push(...batch.map(subscription => subscription.userRef.id))
        },
        1,
        { maxPages: 2, stateStore },
      )
      expect(result.pages).toBeLessThanOrEqual(2)
    }

    expect(dispatched).toEqual(expect.arrayContaining([
      'device-user-0',
      'device-user-1',
      'device-user-2',
      'legacy-user-0',
      'legacy-user-1',
      'legacy-user-2',
    ]))
    expect(dispatched.indexOf('legacy-user-0')).toBeLessThan(dispatched.indexOf('device-user-2'))
  })

  it('checkpoints a small completed batch when dispatch reaches its deadline', async () => {
    const deviceTokens = Array.from({ length: 4 }, (_, index) => `device-token-${index}`.padEnd(24, 'x'))
    const owners = Object.fromEntries(deviceTokens.map((token, index) => [
      createHash('sha256').update(token).digest('hex'),
      { uid: `device-user-${index}`, deviceId: `device-${index}` },
    ]))
    const { database } = notificationDatabase({
      devices: deviceTokens.map((token, index) => ({
        deviceId: `device-${index}`,
        token,
        uid: `device-user-${index}`,
      })),
      owners,
    })
    let now = 0
    const savedStates: Array<Record<string, unknown>> = []

    const result = await scanSubscriptions(
      database,
      async (_subscriptions: unknown[], batch: { deadline: number; checkpointReserveMs: number }) => {
        expect(batch).toEqual({ deadline: 100, checkpointReserveMs: 30 })
        now = 80
      },
      2,
      {
        checkpointReserveMs: 30,
        deadline: 100,
        maxPages: 20,
        now: () => now,
        stateStore: {
          load: async () => ({}),
          save: async (state: Record<string, unknown>) => { savedStates.push({ ...state }) },
        },
      },
    )

    expect(result.pages).toBe(1)
    expect(savedStates).toHaveLength(1)
    expect(savedStates[0].deviceCursor).toBe('users/device-user-1/notificationDevices/device-1')
  })

  it('leaves the cursor untouched when a resolved batch cannot start safely', async () => {
    const token = 'device-token'.padEnd(24, 'x')
    const ownerId = createHash('sha256').update(token).digest('hex')
    const { database } = notificationDatabase({
      devices: [{ deviceId: 'device-1', token, uid: 'device-user' }],
      owners: { [ownerId]: { uid: 'device-user', deviceId: 'device-1' } },
    })
    const savedStates: Array<Record<string, unknown>> = []

    const result = await scanSubscriptions(
      database,
      async () => false,
      1,
      {
        checkpointReserveMs: 30,
        deadline: 100,
        maxPages: 20,
        now: () => 0,
        stateStore: {
          load: async () => ({}),
          save: async (state: Record<string, unknown>) => { savedStates.push({ ...state }) },
        },
      },
    )

    expect(result.pages).toBe(1)
    expect(result.state.deviceCursor).toBeNull()
    expect(savedStates).toEqual([])
  })
})

describe('notification forecast eligibility', () => {
  it('skips an out-of-window stored timezone without requesting a forecast', async () => {
    const originalFetch = global.fetch
    let requests = 0
    global.fetch = async () => {
      requests++
      throw new Error('forecast should not be requested')
    }
    const subscription = {
      lastNotificationKey: null,
      userRef: {
        get: async () => ({
          exists: true,
          data: () => ({
            tier: 'paid',
            notificationHour: 7,
            location: { lat: 34.05, lon: -118.24, timezone: 'America/Los_Angeles' },
          }),
        }),
      },
    }

    try {
      await expect(sendSubscription(subscription, new Date('2026-07-14T03:00:00Z'))).resolves.toEqual({
        outcome: 'skipped',
        reason: 'not-due',
      })
      expect(requests).toBe(0)
    } finally {
      global.fetch = originalFetch
    }
  })
})

describe('notification delivery claims', () => {
  const key = 'daily-v2:2026-07-14'

  it('claims a new day and retries only a recorded definite failure', () => {
    expect(claimDecision({}, key)).toEqual({ claim: true, retry: false })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'failed',
    }, key)).toEqual({ claim: true, retry: true })
  })

  it('suppresses delivered, claimed, and uncertain attempts for the same day', () => {
    expect(claimDecision({ lastNotificationKey: key }, key)).toEqual({
      claim: false,
      reason: 'already-sent',
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryClaimedAt: new Date(1_000),
    }, key)).toEqual({
      claim: false,
      reason: 'already-claimed',
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'unknown',
    }, key)).toEqual({ claim: false, reason: 'delivery-unknown' })
  })

  it('preserves an ambiguous claim regardless of its age', () => {
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryClaimedAt: { toMillis: () => 1_000 },
    }, key)).toEqual({
      claim: false,
      reason: 'already-claimed',
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
    }, key)).toEqual({ claim: false, reason: 'already-claimed' })
  })

  it('allows the next local day even when the previous attempt needs reconciliation', () => {
    expect(claimDecision({
      notificationDeliveryKey: 'daily-v2:2026-07-13',
      notificationDeliveryStatus: 'unknown',
    }, key)).toEqual({ claim: true, retry: false })
  })

  it('retries provider rejections but preserves ambiguous delivery claims', () => {
    expect(failureCertainty({ code: 'messaging/message-rate-exceeded' })).toBe('definite')
    expect(failureCertainty({ code: 'messaging/registration-token-not-registered' })).toBe('definite')
    expect(failureCertainty({ code: 'messaging/server-unavailable' })).toBe('unknown')
    expect(failureCertainty(new Error('socket closed'))).toBe('unknown')
  })

  it('atomically blocks a second sender after the first sender claims the day', async () => {
    const { database, state } = makeDeliveryDatabase({ enabled: true })
    const subscription = {
      token: 'token'.padEnd(24, 'x'),
      deviceId: 'device-1',
      deviceRef: { path: 'users/user-1/notificationDevices/device-1' },
      userRef: { id: 'user-1', kind: 'user' },
    }

    await expect(claimDelivery(subscription, key, 'attempt-1', database, 1_000)).resolves.toEqual({
      claimed: true,
      retry: false,
    })
    state.data.notificationDeliveryClaimedAt = new Date(1_000)
    await expect(claimDelivery(subscription, key, 'attempt-2', database, 1_001)).resolves.toEqual({
      claimed: false,
      reason: 'already-claimed',
    })
    expect(state.data.notificationDeliveryAttemptId).toBe('attempt-1')
  })

  it('rejects a claim after canonical ownership transfers', async () => {
    const state = { enabled: true, token: 'token'.padEnd(24, 'x') }
    const database = {
      collection: () => ({ doc: () => ({ kind: 'owner' }) }),
      runTransaction: (worker: (transaction: {
        get: (ref: { kind?: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      }) => Promise<unknown>) => worker({
        get: async ref => {
          if (ref.kind === 'owner') {
            return { exists: true, data: () => ({ uid: 'user-2', deviceId: 'device-2' }) }
          }
          if (ref.kind === 'user') {
            return { exists: true, data: () => ({ tier: 'paid', location: { lat: 1, lon: 2 } }) }
          }
          return { exists: true, data: () => state }
        },
      }),
    }
    await expect(claimDelivery({
      token: state.token,
      deviceId: 'device-1',
      deviceRef: { path: 'users/user-1/notificationDevices/device-1' },
      userRef: { id: 'user-1', kind: 'user' },
    }, key, 'attempt-1', database)).resolves.toEqual({
      claimed: false,
      reason: 'ownership-changed',
    })
  })

  it('rejects a claim after account deletion starts', async () => {
    const token = 'token'.padEnd(24, 'x')
    const subscription = {
      token,
      deviceId: 'device-1',
      deviceRef: { kind: 'device' },
      userRef: { id: 'user-1', kind: 'user' },
    }
    const database = {
      collection: () => ({ doc: () => ({ kind: 'owner' }) }),
      runTransaction: (worker: (transaction: {
        get: (ref: { kind?: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      }) => Promise<unknown>) => worker({
        get: async ref => {
          if (ref.kind === 'owner') {
            return { exists: true, data: () => ({ uid: 'user-1', deviceId: 'device-1' }) }
          }
          if (ref.kind === 'user') {
            return { exists: true, data: () => ({ accountDeletionStartedAt: new Date() }) }
          }
          return { exists: true, data: () => ({ enabled: true, token }) }
        },
      }),
    }
    await expect(claimDelivery(subscription, key, 'attempt-1', database)).resolves.toEqual({
      claimed: false,
      reason: 'ineligible-user',
    })
  })

  it('rejects a claim after the user loses paid eligibility', async () => {
    const token = 'token'.padEnd(24, 'x')
    const subscription = {
      token,
      deviceId: 'device-1',
      deviceRef: { kind: 'device' },
      userRef: { id: 'user-1', kind: 'user' },
    }
    const database = {
      collection: () => ({ doc: () => ({ kind: 'owner' }) }),
      runTransaction: (worker: (transaction: {
        get: (ref: { kind?: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      }) => Promise<unknown>) => worker({
        get: async ref => {
          if (ref.kind === 'owner') {
            return { exists: true, data: () => ({ uid: 'user-1', deviceId: 'device-1' }) }
          }
          if (ref.kind === 'user') {
            return { exists: true, data: () => ({ tier: 'free', location: { lat: 1, lon: 2 } }) }
          }
          return { exists: true, data: () => ({ enabled: true, token }) }
        },
      }),
    }
    await expect(claimDelivery(subscription, key, 'attempt-1', database)).resolves.toEqual({
      claimed: false,
      reason: 'ineligible-user',
    })
  })

  it('does not finalize an old claim after its token changes', async () => {
    const { database, state } = makeDeliveryDatabase({
      enabled: true,
      notificationDeliveryKey: key,
      notificationDeliveryAttemptId: 'attempt-1',
    })
    const subscription = {
      token: 'old-token'.padEnd(24, 'x'),
      deviceId: 'device-1',
      deviceRef: { path: 'users/user-1/notificationDevices/device-1' },
      userRef: { id: 'user-1', kind: 'user' },
    }
    await expect(finishDelivery(
      subscription,
      key,
      'attempt-1',
      { lastNotificationKey: key },
      database,
    )).resolves.toBe(false)
    expect(state.data.lastNotificationKey).toBeUndefined()
  })

  it('makes only a definite provider rejection retryable', async () => {
    const subscription = {
      token: 'token'.padEnd(24, 'x'),
      deviceId: 'device-1',
      deviceRef: { path: 'users/user-1/notificationDevices/device-1' },
      userRef: { id: 'user-1', kind: 'user' },
    }
    const claimed = {
      enabled: true,
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryAttemptId: 'attempt-1',
    }
    const definite = makeDeliveryDatabase(claimed)
    const ambiguous = makeDeliveryDatabase(claimed)

    await recordDeliveryFailure(
      subscription,
      key,
      'attempt-1',
      { code: 'messaging/message-rate-exceeded' },
      definite.database,
    )
    await recordDeliveryFailure(
      subscription,
      key,
      'attempt-1',
      new Error('socket closed'),
      ambiguous.database,
    )

    expect(definite.state.data.notificationDeliveryStatus).toBe('failed')
    expect(ambiguous.state.data.notificationDeliveryStatus).toBe('unknown')
  })

  it('does not disable a device for a request-level invalid argument', async () => {
    const subscription = {
      token: 'token'.padEnd(24, 'x'),
      deviceId: 'device-1',
      deviceRef: { path: 'users/user-1/notificationDevices/device-1' },
      userRef: { id: 'user-1', kind: 'user' },
    }
    const delivery = makeDeliveryDatabase({
      enabled: true,
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryAttemptId: 'attempt-1',
    })

    await expect(recordDeliveryFailure(
      subscription,
      key,
      'attempt-1',
      { code: 'messaging/invalid-argument' },
      delivery.database,
    )).resolves.toEqual({ certainty: 'definite', deadToken: false })

    expect(delivery.state.data.enabled).toBe(true)
    expect(delivery.state.data.notificationDeliveryStatus).toBe('failed')
  })
})

describe('notification content', () => {
  it('builds qualified lower-UV planning copy', () => {
    const message = buildMessage({
      location: { city: 'Los Angeles' },
      skinType: 'fair',
      activities: [{ id: 'walk', name: 'Walk', icon: '🚶', maxUV: 2, durationMins: 30, sunscreen: false }],
    }, hourly, '2026-07-14')
    expect(message.title).toContain('Walk')
    expect(message.body).toContain('Estimated lower-UV window')
    expect(message.body).toContain('Check current conditions')
  })

  it('does not select an activity that is excluded on the local weekday', () => {
    const message = buildMessage({
      location: { city: 'Los Angeles' },
      activities: [{ id: 'walk', name: 'Walk', icon: '🚶', maxUV: 2, durationMins: 30, sunscreen: false, daysOfWeek: [1] }],
    }, hourly, '2026-07-14')
    expect(message.title).toContain('UV planning update')
  })
})

describe('bounded concurrency', () => {
  it('never runs more workers than the configured limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value: number) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return value * 2
    })
    expect(peak).toBe(2)
    expect(results.map((result: { value: number }) => result.value)).toEqual([2, 4, 6, 8, 10])
  })
})
