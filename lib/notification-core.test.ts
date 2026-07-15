import { describe, expect, it } from 'vitest'

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
  NOTIFICATION_CLAIM_LEASE_MS,
  notificationKey,
  runsOnDate,
} = require('../scripts/notification-core')
const { claimDelivery, loadSubscriptions, notificationScope, recordDeliveryFailure } = require('../scripts/send-notifications')
/* eslint-enable @typescript-eslint/no-require-imports */

const hourly = [
  { hour: 6, uv: 1 },
  { hour: 7, uv: 2 },
  { hour: 8, uv: 5 },
]

function makeDeliveryDatabase(initial: Record<string, unknown>) {
  const state = { data: initial }
  const database = {
    runTransaction: async (worker: (transaction: {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      set: (_ref: unknown, patch: Record<string, unknown>) => void
    }) => Promise<unknown>) => worker({
      get: async () => ({ exists: true, data: () => ({ ...state.data }) }),
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
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1, lon: 2 } })).toBe(true)
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
  }: {
    devices?: Array<{ deviceId: string; token: string; uid: string }>
    legacyUsers?: Array<{ token: string; uid: string }>
    owners?: Record<string, { deviceId: string; uid: string }>
  }) {
    const writes: Array<{ data: Record<string, unknown>; path: string }> = []
    const ref = (path: string, id: string, parent: unknown = null) => ({
      id,
      parent,
      path,
      set: async (data: Record<string, unknown>) => { writes.push({ data, path }) },
    })
    const userRefs = new Map<string, ReturnType<typeof ref>>()
    const userRef = (uid: string) => {
      if (!userRefs.has(uid)) userRefs.set(uid, ref(`users/${uid}`, uid))
      return userRefs.get(uid)!
    }
    const deviceDocs = devices.map(device => {
      const user = userRef(device.uid)
      const parent = { parent: user }
      return {
        id: device.deviceId,
        ref: ref(`users/${device.uid}/notificationDevices/${device.deviceId}`, device.deviceId, parent),
        data: () => ({ enabled: true, token: device.token }),
      }
    })
    const legacyDocs = legacyUsers.map(user => ({
      id: user.uid,
      ref: userRef(user.uid),
      data: () => ({ fcmToken: user.token, notificationsEnabled: true }),
    }))
    return {
      database: {
        collectionGroup: () => ({ where: () => ({ get: async () => ({ docs: deviceDocs }) }) }),
        collection: (name: string) => {
          if (name === 'users') return { where: () => ({ get: async () => ({ docs: legacyDocs }) }) }
          if (name === 'notificationTokenOwners') {
            return { doc: (id: string) => ({ id, owner: owners[id] }) }
          }
          throw new Error(`Unexpected collection ${name}`)
        },
        getAll: async (...ownerRefs: Array<{ owner?: { deviceId: string; uid: string } }>) => ownerRefs.map(ownerRef => ({
          exists: !!ownerRef.owner,
          data: () => ownerRef.owner,
        })),
      },
      writes,
    }
  }

  it('dispatches only to the canonical owner and quarantines stale claims', async () => {
    const token = 'shared-token'.padEnd(24, 'x')
    const ownerId = require('node:crypto').createHash('sha256').update(token).digest('hex')
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

  it('suppresses delivered, leased, and uncertain attempts for the same day', () => {
    expect(claimDecision({ lastNotificationKey: key }, key)).toEqual({
      claim: false,
      reason: 'already-sent',
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryClaimedAt: new Date(1_000),
    }, key, { nowMs: 1_000 + NOTIFICATION_CLAIM_LEASE_MS - 1 })).toEqual({
      claim: false,
      reason: 'already-claimed',
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'unknown',
    }, key)).toEqual({ claim: false, reason: 'delivery-unknown' })
  })

  it('recovers a claim after its dispatcher lease expires', () => {
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
      notificationDeliveryClaimedAt: { toMillis: () => 1_000 },
    }, key, { nowMs: 1_000 + NOTIFICATION_CLAIM_LEASE_MS })).toEqual({
      claim: true,
      retry: true,
    })
    expect(claimDecision({
      notificationDeliveryKey: key,
      notificationDeliveryStatus: 'claimed',
    }, key)).toEqual({ claim: true, retry: true })
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
    const subscription = { deviceRef: { path: 'users/user-1/notificationDevices/device-1' } }

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

  it('makes only a definite provider rejection retryable', async () => {
    const subscription = { deviceRef: { path: 'users/user-1/notificationDevices/device-1' } }
    const claimed = {
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
