// Export and deletion in the browser (lib/account-self-service.ts) over an in-memory
// Firestore. The rules each write relies on are tested on the emulator
// (functions/test/emulator/firestore.rules.test.js, 'self-service account deletion'), and
// the whole flow end to end in tests/e2e/signed-in/account-self-service.e2e.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFunctionResponse } from '@solara/core'
import type { User } from 'firebase/auth'

const mocks = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  /** Commits that fail before this many have been refused. */
  failCommits: 0,
  /** Run after each commit, to simulate another tab writing in between. */
  afterCommit: null as null | (() => void),
  deleteUser: vi.fn(async () => undefined),
}))

vi.mock('./firebase', () => ({
  loadFirebase: async () => ({ db: { root: true } }),
}))

vi.mock('firebase/auth', () => ({ deleteUser: mocks.deleteUser }))

vi.mock('firebase/firestore', () => {
  const DELETE = Symbol('deleteField')
  type Ref = { path: string }
  const ref = (parent: unknown, segments: string[]): Ref => {
    const base = (parent as Partial<Ref> | null)?.path
    return { path: [base, ...segments].filter(Boolean).join('/') }
  }
  const merge = (
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> => {
    const out = { ...target }
    for (const [key, value] of Object.entries(patch)) {
      if (value === DELETE) delete out[key]
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const prior = out[key]
        out[key] = merge(prior && typeof prior === 'object' ? (prior as never) : {}, value as never)
      } else out[key] = value
    }
    return out
  }
  const set = (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    const prior = mocks.store.get(target.path)
    mocks.store.set(target.path, options?.merge ? merge(prior ?? {}, data) : merge({}, data))
  }
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1)!,
    exists: () => mocks.store.has(path),
    data: () => mocks.store.get(path),
  })
  type Constraint = { kind: 'limit'; n: number } | { kind: 'after'; id: string } | { kind: 'x' }
  return {
    deleteField: () => DELETE,
    doc: (parent: unknown, ...segments: string[]) => ref(parent, segments),
    collection: (parent: unknown, ...segments: string[]) => ref(parent, segments),
    documentId: () => '__name__',
    orderBy: () => ({ kind: 'x' }),
    limit: (n: number) => ({ kind: 'limit', n }),
    startAfter: (id: string) => ({ kind: 'after', id }),
    query: (target: Ref, ...constraints: Constraint[]) => ({ path: target.path, constraints }),
    getDoc: async (target: Ref) => snapshot(target.path),
    setDoc: async (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) =>
      set(target, data, options),
    getDocs: async (q: { path: string; constraints: Constraint[] }) => {
      let ids = [...mocks.store.keys()]
        .filter(
          path => path.startsWith(`${q.path}/`) && !path.slice(q.path.length + 1).includes('/'),
        )
        .map(path => path.slice(q.path.length + 1))
        .sort()
      for (const c of q.constraints) {
        if (c.kind === 'after') ids = ids.filter(id => id > c.id)
      }
      for (const c of q.constraints) if (c.kind === 'limit') ids = ids.slice(0, c.n)
      const docs = ids.map(id => snapshot(`${q.path}/${id}`))
      return { docs, size: docs.length }
    },
    writeBatch: () => {
      const ops: (() => void)[] = []
      const batch = {
        set: (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          ops.push(() => set(target, data, options))
          return batch
        },
        delete: (target: Ref) => {
          ops.push(() => mocks.store.delete(target.path))
          return batch
        },
        commit: async () => {
          if (mocks.failCommits > 0) {
            mocks.failCommits--
            throw new Error('unavailable')
          }
          for (const op of ops) op()
          mocks.afterCommit?.()
        },
      }
      return batch
    },
  }
})

const {
  deleteAccountInBrowser,
  exportAccountInBrowser,
  remainingAccountData,
  selfDeletionBlocker,
  SelfDeletionError,
} = await import('./account-self-service')

const UID = 'u1'
const user = { uid: UID } as User
const hex = (n: number) => n.toString(16).padStart(32, '0')

function event(key: string) {
  return {
    key,
    source: 'file',
    seriesId: key,
    title: 'Saturday 10K',
    start: '2026-11-20T15:00:00.000Z',
    end: '2026-11-20T16:30:00.000Z',
    timeZone: 'America/Los_Angeles',
    where: '',
    lat: 34.14,
    lon: -118.29,
    placeLabel: 'Los Angeles, California',
    placeGuessed: false,
    activityId: '',
    url: '',
    createdAt: '2026-10-28T17:30:00.000Z',
    updatedAt: '2026-10-28T17:30:00.000Z',
    expireAt: { toMillis: () => Date.parse('2026-12-20T16:30:00.000Z') },
  }
}

const scheduled = {
  eventId: 'evt1',
  calendarId: 'primary',
  activityId: 'run',
  title: 'Running',
  icon: '🏃',
  start: '2026-11-16T01:00:00.000Z',
  end: '2026-11-16T01:45:00.000Z',
  timeZone: 'America/Los_Angeles',
  htmlLink: 'https://www.google.com/calendar/event?eid=evt1',
  createdAt: '2026-10-28T17:30:00.000Z',
  updatedAt: '2026-10-28T17:30:00.000Z',
}

const link = {
  calendars: [{ id: 'primary', name: '' }],
  connectedAt: '2026-10-28T17:30:00.000Z',
  syncedAt: '',
}

/** An account as the app leaves it, plus an event stored before the key lists existed. */
function seed(account: Record<string, unknown> = {}) {
  const put = (path: string, data: Record<string, unknown>) => mocks.store.set(path, data)
  put(`users/${UID}`, { uid: UID, tier: 'free', skinType: 'fair', ...account })
  const keys = Array.from({ length: 20 }, (_, i) => hex(i + 1))
  for (const key of keys) put(`users/${UID}/events/${key}`, event(key))
  put(`users/${UID}/events/${hex(99)}`, event(hex(99)))
  // A key whose record Firestore's TTL policy already deleted.
  put(`users/${UID}/meta/events`, {
    ids: Object.fromEntries([...keys, hex(500)].map(key => [key, true])),
    removed: [],
  })
  put(`users/${UID}/scheduled/evt1`, scheduled)
  put(`users/${UID}/meta/scheduled`, { ids: { evt1: true }, removed: [] })
  put(`users/${UID}/meta/googleCalendar`, link)
  put(`users/${UID}/meta/outlookCalendar`, link)
  // Another account's data is never touched.
  put('users/u2', { uid: 'u2', tier: 'free' })
  put(`users/u2/events/${hex(1)}`, event(hex(1)))
}

const accountPaths = () => [...mocks.store.keys()].filter(path => path.startsWith(`users/${UID}`))

beforeEach(() => {
  mocks.store.clear()
  mocks.failCommits = 0
  mocks.afterCommit = null
  mocks.deleteUser.mockReset()
  mocks.deleteUser.mockResolvedValue(undefined)
})

describe('selfDeletionBlocker', () => {
  it('leaves billing and server-only records to the server', () => {
    const none = { account: { tier: 'free' }, devices: 0, privateDocs: 0 }
    expect(selfDeletionBlocker(none)).toBeNull()
    expect(selfDeletionBlocker({ ...none, account: null })).toBeNull()
    expect(selfDeletionBlocker({ ...none, account: { tier: 'paid' } })).toBe('billing')
    expect(selfDeletionBlocker({ ...none, account: { stripeCustomerId: 'cus_1' } })).toBe('billing')
    expect(selfDeletionBlocker({ ...none, devices: 1 })).toBe('server-records')
    expect(selfDeletionBlocker({ ...none, privateDocs: 1 })).toBe('server-records')
  })
})

describe('exportAccountInBrowser', () => {
  it('builds the Function’s file from what the owner can read', async () => {
    seed()
    mocks.store.set(`users/${UID}`, { uid: UID, tier: 'free', skinType: 'fair', fcmToken: 'x' })
    const file = await exportAccountInBrowser(UID)
    expect(file.account).toEqual({ uid: UID, tier: 'free', skinType: 'fair' })
    expect(file.importedEvents).toHaveLength(21)
    expect(file.importedEvents[0]).not.toHaveProperty('expireAt')
    expect(file.scheduledActivities.map(item => item.eventId)).toEqual(['evt1'])
    expect(file.googleCalendar?.calendars).toEqual([{ id: 'primary', name: '' }])
    expect(file.outlookCalendar?.calendars).toEqual([{ id: 'primary', name: '' }])
    expect(file.alerts).toEqual([])
    expect(file.truncated).toEqual([])
    expect(JSON.stringify(file)).not.toContain('u2')
    expect(parseFunctionResponse('exportAccountData', JSON.parse(JSON.stringify(file)))).not.toBe(
      null,
    )
  })

  it('reads collections a page at a time, past the rules’ list limit', async () => {
    const keys = Array.from({ length: 450 }, (_, i) => hex(i + 1))
    for (const key of keys) mocks.store.set(`users/${UID}/events/${key}`, event(key))
    const file = await exportAccountInBrowser(UID)
    expect(file.account).toBeNull()
    expect(file.importedEvents.map(item => item.key)).toEqual(keys)
  })
})

describe('deleteAccountInBrowser', () => {
  it('deletes every document of the account, then the sign-in', async () => {
    seed()
    await deleteAccountInBrowser(user)
    expect(accountPaths()).toEqual([])
    expect(mocks.store.has('users/u2')).toBe(true)
    expect(mocks.store.has(`users/u2/events/${hex(1)}`)).toBe(true)
    expect(mocks.deleteUser).toHaveBeenCalledWith(user)
  })

  it('deletes nothing when part of the account is server-only', async () => {
    seed({ stripeCustomerId: 'cus_1' })
    const before = accountPaths()
    await expect(deleteAccountInBrowser(user)).rejects.toMatchObject({ stage: 'blocked' })
    expect(accountPaths()).toEqual(before)

    mocks.store.clear()
    seed()
    mocks.store.set(`users/${UID}/notificationDevices/d1`, { enabled: true })
    await expect(deleteAccountInBrowser(user)).rejects.toBeInstanceOf(SelfDeletionError)
    mocks.store.delete(`users/${UID}/notificationDevices/d1`)
    mocks.store.set(`users/${UID}/private/calendarFeed`, { token: 'x' })
    await expect(deleteAccountInBrowser(user)).rejects.toMatchObject({ stage: 'blocked' })
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('runs again when a write fails or another tab saves in between', async () => {
    seed()
    mocks.failCommits = 1
    let saved = false
    mocks.afterCommit = () => {
      if (saved || mocks.store.has(`users/${UID}`)) return
      // Once the account document is gone, another tab still saves one event.
      saved = true
      mocks.store.set(`users/${UID}/events/${hex(77)}`, event(hex(77)))
    }
    await deleteAccountInBrowser(user)
    expect(saved).toBe(true)
    expect(accountPaths()).toEqual([])
    expect(mocks.deleteUser).toHaveBeenCalledTimes(1)
  })

  it('keeps the sign-in and says so when data could not be deleted', async () => {
    seed()
    mocks.failCommits = 1000
    const error = await deleteAccountInBrowser(user).catch(e => e)
    expect(error).toBeInstanceOf(SelfDeletionError)
    expect(error.stage).toBe('data')
    expect(mocks.store.has(`users/${UID}`)).toBe(true)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('reports a sign-in that could not be deleted after the data was', async () => {
    seed()
    mocks.deleteUser.mockRejectedValueOnce(new Error('auth/network-request-failed'))
    await expect(deleteAccountInBrowser(user)).rejects.toMatchObject({ stage: 'sign-in' })
    expect(accountPaths()).toEqual([])
    // Running again finishes it.
    await deleteAccountInBrowser(user)
    expect(mocks.deleteUser).toHaveBeenCalledTimes(2)
  })

  it('lists what is left', async () => {
    seed()
    expect(await remainingAccountData(UID)).toEqual(
      expect.arrayContaining([
        `users/${UID}`,
        `users/${UID}/meta/events`,
        `users/${UID}/meta/googleCalendar`,
        `users/${UID}/events/${hex(99)}`,
        `users/${UID}/scheduled/evt1`,
      ]),
    )
  })
})
