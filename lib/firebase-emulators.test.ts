import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Local Emulator Suite wiring in lib/firebase-services.ts, used only by emulator builds
// (NEXT_PUBLIC_FIREBASE_EMULATORS=1, made by the signed-in e2e suite).
// scripts/check-no-emulators.mjs proves production exports compile it out.

const mocks = vi.hoisted(() => ({
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  initializeAppCheck: vi.fn((_app: unknown, options: unknown) => ({ kind: 'app-check', options })),
}))

vi.mock('firebase/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({ kind: 'app' })),
}))

vi.mock('firebase/auth', () => ({
  connectAuthEmulator: mocks.connectAuthEmulator,
  getAuth: vi.fn(() => ({ kind: 'auth' })),
  GoogleAuthProvider: class {},
  onAuthStateChanged: vi.fn(() => () => {}),
}))

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
  initializeFirestore: vi.fn(() => ({ kind: 'db' })),
}))

vi.mock('firebase/app-check', () => ({
  CustomProvider: class {
    readonly kind = 'custom'
    constructor(readonly options: { getToken: () => Promise<{ token: string }> }) {}
  },
  getLimitedUseToken: vi.fn(),
  getToken: vi.fn(),
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class {},
  ReCaptchaV3Provider: class {},
}))

async function loadFirebase({ emulators, hostname }: { emulators: boolean; hostname: string }) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'demo-api-key')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-project')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATORS', emulators ? '1' : '')
  vi.stubGlobal('window', {
    location: { hostname, origin: `http://${hostname}:4100`, port: '4100' },
  })
  vi.stubGlobal('self', {})
  // The started SDK (lib/firebase-services.ts) and the light module's App Check settings.
  const services = await import('@/lib/firebase-services')
  return { ...(await import('@/lib/firebase')), ...services }
}

describe('Firebase emulators', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('connects Auth and Firestore to the page origin in emulator builds', async () => {
    await loadFirebase({ emulators: true, hostname: '127.0.0.1' })
    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(
      { kind: 'auth' },
      'http://127.0.0.1:4100',
      { disableWarnings: true },
    )
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith({ kind: 'db' }, '127.0.0.1', 4100)
  })

  it('refuses to connect from anywhere but loopback', async () => {
    await expect(loadFirebase({ emulators: true, hostname: 'solara-uv.web.app' })).rejects.toThrow(
      'only reachable on loopback',
    )
    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled()
  })

  it('never connects in other builds', async () => {
    const firebase = await loadFirebase({ emulators: false, hostname: '127.0.0.1' })
    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled()
    expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled()
    // No site key, so protected endpoints stay off.
    expect(firebase.appCheckConfigured()).toBe(false)
  })

  it('mints a fresh local App Check token per request', async () => {
    const firebase = await loadFirebase({ emulators: true, hostname: '127.0.0.1' })
    expect(firebase.appCheckConfigured()).toBe(true)
    const appCheck = firebase.ensureAppCheck() as unknown as {
      options: { provider: { options: { getToken: () => Promise<{ token: string }> } } }
    }
    const { getToken } = appCheck.options.provider.options
    const [first, second] = await Promise.all([getToken(), getToken()])
    expect(first.token).toMatch(/^solara-firebase-emulators\./)
    expect(second.token).not.toBe(first.token)
  })
})
