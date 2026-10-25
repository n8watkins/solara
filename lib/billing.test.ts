import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Firebase from '@/lib/firebase'

const firestore = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'users/user-1' })),
  getDoc: vi.fn(),
  onSnapshot: firestore.onSnapshot,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}))

const appCheck = vi.hoisted(() => ({ token: vi.fn() }))

vi.mock('@/lib/firebase', async importOriginal => ({
  ...(await importOriginal<typeof Firebase>()),
  loadFirebase: async () => ({ db: { kind: 'test-db' } }),
  appCheckConfigured: () => !!process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY,
  appCheckToken: appCheck.token,
}))

async function freshBilling() {
  vi.resetModules()
  return import('@/lib/billing')
}

describe('authenticated checkout', () => {
  const original = process.env.NEXT_PUBLIC_FUNCTIONS_URL

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', 'site-key')
    appCheck.token.mockImplementation(async ({ limitedUse = false } = {}) =>
      limitedUse ? 'limited-use-app-check' : 'app-check',
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = original
    vi.unstubAllGlobals()
    firestore.onSnapshot.mockReset()
  })

  it('reports unconfigured when the Functions URL is absent', async () => {
    delete process.env.NEXT_PUBLIC_FUNCTIONS_URL
    const { createBillingPortalUrl, createCheckoutUrl, isCheckoutConfigured } = await freshBilling()
    expect(isCheckoutConfigured()).toBe(false)
    await expect(createCheckoutUrl({ getIdToken: vi.fn() } as never)).rejects.toThrow(
      'not configured',
    )
    await expect(createBillingPortalUrl({ getIdToken: vi.fn() } as never)).rejects.toThrow(
      'not configured',
    )
  })

  it('creates checkout with a freshly issued Firebase ID token', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test/'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay_test' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '12345678-1234-1234-1234-123456789abc') })
    const getIdToken = vi.fn().mockResolvedValue('firebase-id-token')
    const { createCheckoutUrl, isCheckoutConfigured } = await freshBilling()

    expect(isCheckoutConfigured()).toBe(true)
    await expect(createCheckoutUrl({ getIdToken } as never)).resolves.toBe(
      'https://checkout.stripe.com/c/pay_test',
    )
    expect(getIdToken).toHaveBeenCalledWith(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://functions.example.test/createCheckoutSession',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'X-Firebase-AppCheck': 'limited-use-app-check',
        }),
        body: JSON.stringify({ attemptId: '12345678-1234-1234-1234-123456789abc' }),
      }),
    )
    expect(appCheck.token).toHaveBeenCalledWith({ limitedUse: true })
  })

  it('reports unconfigured without an App Check site key', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test'
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', '')
    const { isCheckoutConfigured } = await freshBilling()
    expect(isCheckoutConfigured()).toBe(false)
  })

  it('shows the allowlisted server message when checkout is refused', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Account already has a subscription', code: 'conflict' }),
      }),
    )
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '12345678-1234-1234-1234-123456789abc') })
    const { createCheckoutUrl } = await freshBilling()
    await expect(
      createCheckoutUrl({ getIdToken: vi.fn().mockResolvedValue('token') } as never),
    ).rejects.toMatchObject({ message: 'Account already has a subscription', code: 'conflict' })
  })

  it('rejects untrusted checkout URLs returned by the backend', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://attacker.example/checkout' }),
      }),
    )
    const { createCheckoutUrl } = await freshBilling()
    await expect(
      createCheckoutUrl({ getIdToken: vi.fn().mockResolvedValue('token') } as never),
    ).rejects.toThrow('unavailable')
  })

  it('opens only Stripe-hosted billing portal sessions', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://billing.stripe.com/session/test' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const getIdToken = vi.fn().mockResolvedValue('firebase-id-token')
    const { createBillingPortalUrl } = await freshBilling()

    await expect(createBillingPortalUrl({ getIdToken } as never)).resolves.toBe(
      'https://billing.stripe.com/session/test',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://functions.example.test/createBillingPortalSession',
      expect.objectContaining({ method: 'POST' }),
    )

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://attacker.example/' }),
    })
    await expect(createBillingPortalUrl({ getIdToken } as never)).rejects.toThrow('unavailable')
  })

  it('observes the returned checkout until its entitlement settles', async () => {
    const snapshots: Array<
      (snapshot: { exists: () => boolean; data: () => Record<string, unknown> }) => void
    > = []
    const unsubscribe = vi.fn()
    firestore.onSnapshot.mockImplementation((_ref, onNext) => {
      snapshots.push(onNext)
      return unsubscribe
    })
    const { observeCheckoutResult } = await freshBilling()
    const onResult = vi.fn()
    const stop = observeCheckoutResult('user-1', 'cs_returned', onResult, vi.fn())
    // Firestore loads on demand, then the listener starts.
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    const basePrefs = {
      uid: 'user-1',
      location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' },
      skinType: 'fair',
      sunscreen: false,
      activities: [],
      onboardingComplete: true,
    }

    snapshots[0]!({
      exists: () => true,
      data: () => ({
        ...basePrefs,
        tier: 'free',
        stripeCheckoutSessionId: 'cs_returned',
        stripeCheckoutStatus: 'pending',
      }),
    })
    expect(onResult).toHaveBeenLastCalledWith({ status: 'pending' })

    snapshots[0]!({
      exists: () => true,
      data: () => ({
        ...basePrefs,
        tier: 'paid',
        stripeCheckoutSessionId: 'cs_returned',
        stripeCheckoutStatus: 'succeeded',
      }),
    })
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        prefs: expect.not.objectContaining({ stripeCheckoutSessionId: expect.anything() }),
      }),
    )

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
