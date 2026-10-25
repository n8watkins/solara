import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authListener: null as ((user: unknown) => void) | null,
  initializeAppCheck: vi.fn(() => ({ kind: 'app-check' })),
  getToken: vi.fn(async () => ({ token: 'standard-token' })),
  getLimitedUseToken: vi.fn(async () => ({ token: 'limited-token' })),
  initializeAuth: vi.fn((_app: unknown, _options: unknown) => ({ kind: 'auth' })),
  getRedirectResult: vi.fn(async () => null),
}))

vi.mock('firebase/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({ kind: 'app' })),
}))

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: 'local',
  browserPopupRedirectResolver: 'popup-helper',
  browserSessionPersistence: 'session',
  getAuth: vi.fn(() => ({ kind: 'auth' })),
  getRedirectResult: mocks.getRedirectResult,
  GoogleAuthProvider: class {},
  indexedDBLocalPersistence: 'indexed-db',
  initializeAuth: mocks.initializeAuth,
  onAuthStateChanged: vi.fn((_auth: unknown, listener: (user: unknown) => void) => {
    mocks.authListener = listener
    return () => {}
  }),
}))

vi.mock('firebase/firestore', () => ({ initializeFirestore: vi.fn(() => ({ kind: 'db' })) }))

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  getToken: mocks.getToken,
  getLimitedUseToken: mocks.getLimitedUseToken,
  ReCaptchaV3Provider: class {
    readonly kind = 'v3'
    constructor(readonly siteKey: string) {}
  },
  ReCaptchaEnterpriseProvider: class {
    readonly kind = 'enterprise'
    constructor(readonly siteKey: string) {}
  },
}))

async function loadFirebase(provider?: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'api-key')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-project')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', 'site-key')
  if (provider) vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER', provider)
  // The started SDK (lib/firebase-services.ts) and the light module's App Check settings.
  const services = await import('@/lib/firebase-services')
  return { ...(await import('@/lib/firebase')), ...services }
}

describe('App Check', () => {
  beforeEach(() => {
    mocks.authListener = null
    vi.stubGlobal('window', {})
    vi.stubGlobal('self', {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not load reCAPTCHA until someone signs in', async () => {
    await loadFirebase()
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled()

    mocks.authListener?.(null)
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled()

    mocks.authListener?.({ uid: 'user-1' })
    mocks.authListener?.({ uid: 'user-1' })
    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1)
  })

  it('uses reCAPTCHA v3 by default and Enterprise when configured', async () => {
    const v3 = await loadFirebase()
    expect(v3.appCheckProviderKind()).toBe('recaptcha-v3')
    v3.ensureAppCheck()
    expect(mocks.initializeAppCheck).toHaveBeenLastCalledWith(
      { kind: 'app' },
      expect.objectContaining({
        provider: expect.objectContaining({ kind: 'v3', siteKey: 'site-key' }),
        isTokenAutoRefreshEnabled: true,
      }),
    )

    const enterprise = await loadFirebase('recaptcha-enterprise')
    expect(enterprise.appCheckProviderKind()).toBe('recaptcha-enterprise')
    enterprise.ensureAppCheck()
    expect(mocks.initializeAppCheck).toHaveBeenLastCalledWith(
      { kind: 'app' },
      expect.objectContaining({
        provider: expect.objectContaining({ kind: 'enterprise', siteKey: 'site-key' }),
      }),
    )
  })

  it('mints limited-use tokens for replay-protected requests', async () => {
    const firebase = await loadFirebase()
    await expect(firebase.appCheckToken()).resolves.toBe('standard-token')
    await expect(firebase.appCheckToken({ limitedUse: true })).resolves.toBe('limited-token')
    expect(mocks.getLimitedUseToken).toHaveBeenCalledTimes(1)
  })

  it('treats unknown provider names as v3', async () => {
    const firebase = await loadFirebase()
    expect(firebase.appCheckProviderKind('recaptcha')).toBe('recaptcha-v3')
  })

  it("starts Auth with getAuth()'s persistence but not its sign-in popup helper", async () => {
    const firebase = await loadFirebase()
    expect(mocks.initializeAuth).toHaveBeenCalledWith(
      { kind: 'app' },
      { persistence: ['indexed-db', 'local', 'session'] },
    )
    expect(mocks.getRedirectResult).not.toHaveBeenCalled()

    // A sign-in about to happen starts the helper, once.
    firebase.prepareSignInPopup()
    firebase.prepareSignInPopup()
    expect(mocks.getRedirectResult).toHaveBeenCalledTimes(1)
    expect(mocks.getRedirectResult).toHaveBeenCalledWith({ kind: 'auth' }, 'popup-helper')
    expect(firebase.popupRedirectResolver).toBe('popup-helper')
  })
})
