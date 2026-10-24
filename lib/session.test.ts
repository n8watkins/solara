// Account isolation on a shared browser (FE-3): after one account leaves, by
// signing out or by its session simply ending, the next account to sign in on the
// same browser must inherit nothing from it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // In-memory Firestore `users` collection, keyed by uid.
  users: new Map<string, Record<string, unknown>>(),
  failWrites: false,
  signOut: vi.fn(),
  deleteToken: vi.fn(),
  getIdToken: vi.fn(),
  currentUser: null as null | { uid: string; getIdToken: () => Promise<string> },
}))

vi.mock('firebase/firestore', () => {
  type Ref = { id: string }
  const snapshot = (ref: Ref) => ({
    exists: () => mocks.users.has(ref.id),
    data: () => mocks.users.get(ref.id),
  })
  const write = (ref: Ref, data: Record<string, unknown>) => {
    if (mocks.failWrites) throw new Error('permission-denied')
    mocks.users.set(ref.id, JSON.parse(JSON.stringify(data)) as Record<string, unknown>)
  }
  return {
    doc: (_db: unknown, _collection: string, id: string): Ref => ({ id }),
    getDoc: async (ref: Ref) => snapshot(ref),
    updateDoc: async (ref: Ref, data: Record<string, unknown>) =>
      write(ref, { ...mocks.users.get(ref.id), ...data }),
    runTransaction: async (
      _db: unknown,
      fn: (tx: {
        get: (ref: Ref) => Promise<ReturnType<typeof snapshot>>
        set: (ref: Ref, data: Record<string, unknown>) => void
      }) => Promise<unknown>,
    ) => {
      const pending: [Ref, Record<string, unknown>][] = []
      const result = await fn({
        get: async ref => snapshot(ref),
        set: (ref, data) => void pending.push([ref, data]),
      })
      for (const [ref, data] of pending) write(ref, data)
      return result
    },
  }
})

vi.mock('firebase/auth', () => ({ signOut: mocks.signOut }))
vi.mock('firebase/app-check', () => ({ getToken: vi.fn() }))
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({ kind: 'messaging' })),
  getToken: vi.fn(),
  deleteToken: mocks.deleteToken,
  onMessage: vi.fn(() => () => {}),
}))
vi.mock('@/lib/firebase', () => ({
  app: { kind: 'app' },
  appCheck: null,
  appCheckConfigured: () => true,
  appCheckToken: async () => 'app-check-token',
  db: { kind: 'db' },
  auth: {
    get currentUser() {
      return mocks.currentUser
    },
  },
}))

import { setCachedForecast } from '@/lib/cache'
import { createAccountPrefs, defaultPrefs, saveLocalPrefs } from '@/lib/prefs'
import { GUEST_KEY, loadGuestPrefs, saveGuestPrefs } from '@/lib/guest'
import { SignOutBlockedError, loadAccountPrefs, signOutAndClear } from '@/lib/session'
import type { ForecastData, Location, UserPreferences } from '@/lib/types'

const storage = new Map<string, string>()

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const BOSTON: Location = { lat: 42.36, lon: -71.06, city: 'Boston', region: 'MA' }
const A_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

// Includes a legacy feed token field so the tests prove old stored data never leaks.
const accountA: UserPreferences & { calendarFeedToken?: string } = {
  ...defaultPrefs(LA),
  uid: 'user-a',
  tier: 'paid',
  skinType: 'very-fair',
  onboardingComplete: true,
  calendarFeedToken: A_TOKEN,
  savedLocations: [BOSTON],
  profiles: [{ id: 'kid', name: 'Kid', skinType: 'fair' }],
  activities: [
    { id: 'custom_run', name: 'Run', icon: '🏃', durationMins: 30, maxUV: 3, sunscreen: false },
  ],
}

const weather: ForecastData = {
  timezone: 'America/Los_Angeles',
  fetchedAt: Date.now(),
  current: { uv: 7, tempC: 27, condition: 'Clear' },
  days: [],
}

/** Signs in an existing account and leaves what a session stores in the browser. */
async function useSolaraAs(prefs: UserPreferences) {
  mocks.currentUser = { uid: prefs.uid, getIdToken: mocks.getIdToken }
  mocks.users.set(prefs.uid, JSON.parse(JSON.stringify(prefs)) as Record<string, unknown>)
  await expect(loadAccountPrefs(prefs.uid)).resolves.toMatchObject({ status: 'ready' })
  saveLocalPrefs(prefs)
  setCachedForecast(prefs.location.lat, prefs.location.lon, weather)
  storage.set(
    `solara_notification_device_${prefs.uid}`,
    JSON.stringify({ deviceId: 'device-a', token: 'fcm-token-a' }),
  )
  storage.set('solara_fcm_token', 'legacy-fcm-token-a')
}

/** Every stored value, to prove nothing of A's survives anywhere. */
function storedText(): string {
  return [...storage.entries()].map(([key, value]) => `${key}=${value}`).join('\n')
}

function expectNothingFromA() {
  const text = storedText()
  for (const trace of ['user-a', A_TOKEN, 'Los Angeles', 'Boston', 'very-fair', 'fcm-token-a']) {
    expect(text).not.toContain(trace)
  }
}

beforeEach(() => {
  storage.clear()
  mocks.users.clear()
  mocks.failWrites = false
  mocks.currentUser = null
  vi.clearAllMocks()
  mocks.signOut.mockResolvedValue(undefined)
  mocks.deleteToken.mockResolvedValue(true)
  mocks.getIdToken.mockResolvedValue('id-token')
  vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', 'https://functions.example.test')
  // The removeNotificationDevice success body (functions/src/notifications/devices.ts).
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ deviceId: 'device', removed: true }) }),
  )
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  })
})

describe('switching accounts on one browser', () => {
  it('user A signs out, then new user B signs in and inherits nothing', async () => {
    await useSolaraAs(accountA)

    await signOutAndClear('user-a')
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'https://functions.example.test/removeNotificationDevice',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expectNothingFromA()

    mocks.currentUser = { uid: 'user-b', getIdToken: mocks.getIdToken }
    await expect(loadAccountPrefs('user-b')).resolves.toEqual({ status: 'needs-onboarding' })
    expect(mocks.users.has('user-b')).toBe(false)
    expectNothingFromA()
  })

  it("discards A's data when A's session ended without signing out", async () => {
    await useSolaraAs(accountA)

    // No sign-out: the session expired or was revoked, and B signs in next.
    mocks.currentUser = { uid: 'user-b', getIdToken: mocks.getIdToken }
    await expect(loadAccountPrefs('user-b')).resolves.toEqual({ status: 'needs-onboarding' })
    expect(mocks.users.has('user-b')).toBe(false)
    expectNothingFromA()
    expect(mocks.deleteToken).toHaveBeenCalled()
  })

  it("never seeds B's new account from prefs another account left behind", async () => {
    // Prefs saved by an older version, before the owner marker existed.
    saveLocalPrefs(accountA)
    await expect(loadAccountPrefs('user-b')).resolves.toEqual({ status: 'needs-onboarding' })
    expect(mocks.users.has('user-b')).toBe(false)
    expectNothingFromA()
  })

  it('keeps the same account signed back in on its own data', async () => {
    await useSolaraAs(accountA)
    const result = await loadAccountPrefs('user-a')
    expect(result).toMatchObject({ status: 'ready', prefs: { uid: 'user-a', tier: 'paid' } })
    expect(storedText()).toContain('Los Angeles')
  })
})

describe('signOutAndClear', () => {
  it('stops before signing out if this device cannot leave notifications', async () => {
    await useSolaraAs(accountA)
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    mocks.deleteToken.mockRejectedValue(new Error('offline'))

    await expect(signOutAndClear('user-a')).rejects.toBeInstanceOf(SignOutBlockedError)
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('clears local data even without a signed-in user', async () => {
    saveLocalPrefs(accountA)
    setCachedForecast(LA.lat, LA.lon, weather)
    await signOutAndClear(null)
    expect(storage.size).toBe(0)
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
})

describe('creating a new account', () => {
  it('seeds only onboarding answers, on the free tier', async () => {
    // Onboarding answers, plus fields that must never reach a new account.
    saveLocalPrefs({ ...accountA, uid: '' })
    const result = await loadAccountPrefs('user-b')
    const expected: UserPreferences = {
      ...defaultPrefs(LA),
      uid: 'user-b',
      tier: 'free',
      skinType: 'very-fair',
      onboardingComplete: true,
    }
    expect(result).toEqual({ status: 'ready', prefs: expected })
    expect(mocks.users.get('user-b')).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  it('never overwrites an account created concurrently', async () => {
    mocks.users.set('user-a', JSON.parse(JSON.stringify(accountA)) as Record<string, unknown>)
    const prefs = await createAccountPrefs('user-a', { ...defaultPrefs(BOSTON), uid: '' })
    expect(prefs).toMatchObject({ tier: 'paid', location: { city: 'Los Angeles' } })
    expect(mocks.users.get('user-a')).toMatchObject({ calendarFeedToken: A_TOKEN })
  })

  it('shows the account that sign-in from setup created, even if a read still misses it', async () => {
    await useSolaraAs(accountA)
    mocks.currentUser = { uid: 'user-b', getIdToken: mocks.getIdToken }
    const created = await createAccountPrefs('user-b', { ...defaultPrefs(BOSTON), uid: '' })
    // A Firestore listen opened before that transaction committed still reports the
    // document as missing.
    mocks.users.delete('user-b')

    await expect(loadAccountPrefs('user-b', created)).resolves.toEqual({
      status: 'ready',
      prefs: created,
    })
    expectNothingFromA()
  })

  it("never shows another account's document from sign-in", async () => {
    await expect(loadAccountPrefs('user-b', accountA)).resolves.toEqual({
      status: 'needs-onboarding',
    })
  })

  it('reports a failed account creation instead of hanging', async () => {
    saveLocalPrefs({ ...defaultPrefs(LA), onboardingComplete: true })
    mocks.failWrites = true
    const result = await loadAccountPrefs('user-b')
    expect(result).toMatchObject({ status: 'error', stage: 'create' })
  })
})

describe('a guest signing in', () => {
  const RUN = {
    id: 'custom_run',
    name: 'Run',
    icon: '🏃',
    durationMins: 30,
    maxUV: 3,
    sunscreen: true,
  }
  const guestPlan: UserPreferences = {
    ...defaultPrefs(BOSTON),
    skinType: 'olive',
    activities: [RUN],
    temperatureUnit: 'celsius',
    onboardingComplete: true,
  }

  it('carries the guest plan into a brand-new account, then drops it from this browser', async () => {
    saveGuestPrefs(guestPlan)
    const result = await loadAccountPrefs('user-b')
    expect(result).toMatchObject({
      status: 'ready',
      prefs: {
        uid: 'user-b',
        tier: 'free',
        skinType: 'olive',
        location: { city: 'Boston' },
        activities: [RUN],
        temperatureUnit: 'celsius',
      },
    })
    expect(mocks.users.get('user-b')).toMatchObject({ activities: [RUN], tier: 'free' })
    expect(storage.has(GUEST_KEY)).toBe(false)
  })

  it('never adds the guest plan to an account that already exists', async () => {
    mocks.users.set('user-a', JSON.parse(JSON.stringify(accountA)) as Record<string, unknown>)
    saveGuestPrefs(guestPlan)

    // Sign-in's own transaction finds the existing account and writes nothing.
    const fromSignIn = await createAccountPrefs('user-a', loadGuestPrefs(), 'guest')
    expect(fromSignIn).toMatchObject({ tier: 'paid', skinType: 'very-fair' })

    const result = await loadAccountPrefs('user-a')
    expect(result).toMatchObject({
      status: 'ready',
      prefs: {
        uid: 'user-a',
        tier: 'paid',
        skinType: 'very-fair',
        activities: accountA.activities,
      },
    })
    expect(mocks.users.get('user-a')).toMatchObject({
      location: { city: 'Los Angeles' },
      activities: accountA.activities,
    })
    // Dropped, so no later account on this device can inherit it either.
    expect(storage.has(GUEST_KEY)).toBe(false)
  })

  it('keeps the guest plan when the account could not be loaded', async () => {
    saveGuestPrefs(guestPlan)
    mocks.failWrites = true
    await expect(loadAccountPrefs('user-b')).resolves.toMatchObject({ status: 'error' })
    expect(loadGuestPrefs()).toMatchObject({ activities: [RUN] })
  })

  it('carries at most the free plan, and nothing an account owns', async () => {
    const more = [1, 2, 3, 4].map(i => ({ ...RUN, id: `custom_${i}` }))
    const created = await createAccountPrefs(
      'user-c',
      { ...guestPlan, activities: more, tier: 'paid', uid: 'user-a', savedLocations: [LA] },
      'guest',
    )
    expect(created.activities).toHaveLength(3)
    expect(created).toMatchObject({ uid: 'user-c', tier: 'free', savedLocations: [] })
  })
})
