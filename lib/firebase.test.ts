import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/firebase.ts: Firebase loads on demand, and only for a session this browser holds
// or a sign-in. The SDK itself (lib/firebase-services.ts) is replaced by a stub, so
// these tests see exactly when it would load.

const services = vi.hoisted(() => ({ loads: 0 }))

vi.mock('@/lib/firebase-services', () => {
  services.loads += 1
  return { app: { kind: 'app' }, auth: { kind: 'auth' }, db: { kind: 'db' } }
})

const API_KEY = 'demo-api-key'
const USER_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`

function memoryStorage(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

async function freshFirebase({
  configured = true,
  storage = {},
}: { configured?: boolean; storage?: Record<string, string> } = {}) {
  vi.resetModules()
  services.loads = 0
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', configured ? API_KEY : '')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', configured ? 'demo-project' : '')
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', memoryStorage(storage))
  return import('@/lib/firebase')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('loadFirebase', () => {
  it('loads the SDK once, on the first call, and tells every listener', async () => {
    const firebase = await freshFirebase()
    const listener = vi.fn()
    firebase.whenFirebaseLoads(listener)
    expect(services.loads).toBe(0)
    expect(firebase.loadedFirebase()).toBeNull()

    const [first, second] = await Promise.all([firebase.loadFirebase(), firebase.loadFirebase()])
    expect(first).toBe(second)
    expect(first?.db).toEqual({ kind: 'db' })
    expect(services.loads).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(firebase.loadedFirebase()).toBe(first)

    // A listener added afterwards hears about it right away.
    const late = vi.fn()
    firebase.whenFirebaseLoads(late)
    expect(late).toHaveBeenCalledWith(first)
  })

  it('stops telling a listener that unsubscribed', async () => {
    const firebase = await freshFirebase()
    const listener = vi.fn()
    const stop = firebase.whenFirebaseLoads(listener)
    stop()
    await firebase.loadFirebase()
    expect(listener).not.toHaveBeenCalled()
  })

  it('never loads in a build without Firebase', async () => {
    const firebase = await freshFirebase({ configured: false })
    expect(firebase.firebaseEnabled).toBe(false)
    await expect(firebase.loadFirebase()).resolves.toBeNull()
    expect(services.loads).toBe(0)
  })
})

describe('storedSessionHint', () => {
  it('is false for a visitor with nothing stored', async () => {
    const firebase = await freshFirebase()
    expect(firebase.storedSessionHint()).toBe(false)
  })

  it('is true after a sign-in on this browser (the account marker)', async () => {
    const firebase = await freshFirebase({ storage: { solara_account_owner: 'user-1' } })
    expect(firebase.storedSessionHint()).toBe(true)
  })

  it('is true when Auth kept its user in localStorage', async () => {
    const firebase = await freshFirebase({ storage: { [USER_KEY]: '{"uid":"user-1"}' } })
    expect(firebase.storedSessionHint()).toBe(true)
  })

  it('is false when storage cannot be read', async () => {
    const firebase = await freshFirebase()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(firebase.storedSessionHint()).toBe(false)
  })

  it('is false without Firebase, whatever is stored', async () => {
    const firebase = await freshFirebase({
      configured: false,
      storage: { solara_account_owner: 'user-1' },
    })
    expect(firebase.storedSessionHint()).toBe(false)
  })
})

describe('storedSessionInIndexedDb', () => {
  type Handler = (() => void) | null

  /** A one-database stand-in for IndexedDB, with Auth's store if `user` is given. */
  function fakeIndexedDb(state: { exists: boolean; user?: unknown }) {
    const aborted = vi.fn()
    const closed = vi.fn()
    const indexedDB = {
      open: vi.fn((name: string) => {
        expect(name).toBe('firebaseLocalStorageDb')
        const request = {
          result: null as unknown,
          transaction: { abort: aborted },
          onupgradeneeded: null as Handler,
          onsuccess: null as Handler,
          onerror: null as Handler,
          onblocked: null as Handler,
        }
        queueMicrotask(() => {
          if (!state.exists) {
            request.onupgradeneeded?.()
            request.onerror?.()
            return
          }
          request.result = {
            objectStoreNames: { contains: (store: string) => store === 'firebaseLocalStorage' },
            close: closed,
            transaction: () => ({
              objectStore: () => ({
                get: (key: string) => {
                  const get = { result: undefined as unknown, onsuccess: null as Handler }
                  queueMicrotask(() => {
                    get.result =
                      key === USER_KEY && state.user !== undefined
                        ? { fbase_key: key, value: state.user }
                        : undefined
                    get.onsuccess?.()
                  })
                  return get
                },
              }),
            }),
          }
          request.onsuccess?.()
        })
        return request
      }),
    }
    return { indexedDB, aborted, closed }
  }

  beforeEach(() => vi.unstubAllGlobals())

  it('finds the user Auth keeps in IndexedDB', async () => {
    const firebase = await freshFirebase()
    const fake = fakeIndexedDb({ exists: true, user: { uid: 'user-1' } })
    vi.stubGlobal('indexedDB', fake.indexedDB)
    await expect(firebase.storedSessionInIndexedDb()).resolves.toBe(true)
    expect(fake.closed).toHaveBeenCalled()
  })

  it('is false when the store has no user', async () => {
    const firebase = await freshFirebase()
    vi.stubGlobal('indexedDB', fakeIndexedDb({ exists: true }).indexedDB)
    await expect(firebase.storedSessionInIndexedDb()).resolves.toBe(false)
  })

  it('never creates the database when there is none', async () => {
    const firebase = await freshFirebase()
    const fake = fakeIndexedDb({ exists: false })
    vi.stubGlobal('indexedDB', fake.indexedDB)
    await expect(firebase.storedSessionInIndexedDb()).resolves.toBe(false)
    expect(fake.aborted).toHaveBeenCalled()
  })

  it('is false where IndexedDB does not exist', async () => {
    const firebase = await freshFirebase()
    await expect(firebase.storedSessionInIndexedDb()).resolves.toBe(false)
  })
})

describe('lazySubscription', () => {
  it('passes the started subscription through to the stop function', async () => {
    const { lazySubscription } = await freshFirebase()
    const unsubscribe = vi.fn()
    const stop = lazySubscription(async () => unsubscribe, vi.fn())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(unsubscribe).not.toHaveBeenCalled()
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('ends a subscription that starts after it was already stopped', async () => {
    const { lazySubscription } = await freshFirebase()
    const unsubscribe = vi.fn()
    let start: (value: () => void) => void = () => {}
    const stop = lazySubscription(() => new Promise(resolve => (start = resolve)), vi.fn())
    stop()
    start(unsubscribe)
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))
  })

  it('reports a failed start, unless it was stopped first', async () => {
    const { lazySubscription } = await freshFirebase()
    const onError = vi.fn()
    lazySubscription(() => Promise.reject(new Error('offline')), onError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(new Error('offline')))

    const quiet = vi.fn()
    const stop = lazySubscription(() => Promise.reject(new Error('offline')), quiet)
    stop()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(quiet).not.toHaveBeenCalled()
  })
})
