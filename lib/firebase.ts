import type { FirebaseApp } from 'firebase/app'
import { initializeApp, getApps } from 'firebase/app'
import type { AppCheck } from 'firebase/app-check'
import {
  CustomProvider,
  getLimitedUseToken,
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from 'firebase/app-check'
import type { Auth } from 'firebase/auth'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore'

const hasConfig = !!(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let googleProvider: GoogleAuthProvider | null = null

if (hasConfig) {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }

  app = getApps()[0] ?? initializeApp(firebaseConfig)
  auth = getAuth(app)
  // ignoreUndefinedProperties: normalizePrefs emits undefined for absent optional fields
  // (activeProfileId, calendarHours, …); without this, updateDoc/setDoc throw on those
  // instead of simply omitting them.
  db = initializeFirestore(app, { ignoreUndefinedProperties: true })
  googleProvider = new GoogleAuthProvider()

  // Emulator builds only; see connectEmulators. The flag is inlined at build time, so
  // in every other build this condition is the literal `false` and the minifier
  // removes the branch together with everything only it references.
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1' && typeof window !== 'undefined') {
    connectEmulators(auth, db)
  }

  // App Check loads reCAPTCHA, a third-party script, so it starts only once someone signs
  // in. Every App Check-protected request (Cloud Functions, and Firestore if enforcement
  // is turned on) happens after sign-in.
  if (typeof window !== 'undefined') {
    onAuthStateChanged(auth, user => {
      if (user) ensureAppCheck()
    })
  }
}

// ---- Local Emulator Suite (signed-in e2e only) ------------------------------------

/**
 * Points Auth and Firestore at the Firebase Local Emulator Suite. Only the signed-in
 * e2e suite (tests/e2e/signed-in) builds with NEXT_PUBLIC_FIREBASE_EMULATORS=1: its
 * test server serves the export and forwards the emulator APIs on the same origin,
 * so the real Content-Security-Policy ('self') still applies. `npm run build`, the
 * only production build, refuses the flag (scripts/check-no-emulators.mjs), and the
 * page refuses to connect from anywhere but a loopback address.
 */
function connectEmulators(authInstance: Auth, firestore: Firestore): void {
  const { hostname, origin, port } = window.location
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    // The marker text is what the production leak check looks for.
    throw new Error('solara-firebase-emulators: emulators are only reachable on loopback')
  }
  connectAuthEmulator(authInstance, origin, { disableWarnings: true })
  connectFirestoreEmulator(firestore, hostname, Number(port))
}

/**
 * App Check for emulator builds. There is no App Check emulator, and a real provider
 * (even the debug one) must reach Google, so the page mints opaque local tokens that
 * only the Functions emulator accepts (tests/e2e/signed-in/emulator-app-check.js).
 * Each call returns a fresh token, so limited-use replay protection still applies.
 */
function emulatorAppCheckProvider(): CustomProvider {
  return new CustomProvider({
    getToken: async () => ({
      token: `solara-firebase-emulators.${crypto.randomUUID()}`,
      expireTimeMillis: Date.now() + 60 * 60 * 1000,
    }),
  })
}

// ---- App Check ------------------------------------------------------------------------

export type AppCheckProviderKind = 'recaptcha-enterprise' | 'recaptcha-v3'

/**
 * Which reCAPTCHA product backs App Check. Set NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER to
 * `recaptcha-enterprise` once an Enterprise key is registered in the Firebase console; the
 * default stays `recaptcha-v3` so existing v3 site keys keep working.
 */
export function appCheckProviderKind(
  value = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_PROVIDER,
): AppCheckProviderKind {
  return value === 'recaptcha-enterprise' ? 'recaptcha-enterprise' : 'recaptcha-v3'
}

/** Whether a site key is configured, so protected endpoints can be called at all. */
export function appCheckConfigured(): boolean {
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1') return true
  return !!process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY
}

let appCheck: AppCheck | null = null

/** Initializes App Check once, on demand. Returns null when unconfigured or server-side. */
export function ensureAppCheck(): AppCheck | null {
  if (appCheck) return appCheck
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1') {
    if (!app || typeof window === 'undefined') return null
    appCheck = initializeAppCheck(app, {
      provider: emulatorAppCheckProvider(),
      isTokenAutoRefreshEnabled: true,
    })
    return appCheck
  }
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY
  if (!app || !siteKey || typeof window === 'undefined') return null
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN
  if (debugToken) {
    ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken
  }
  const provider =
    appCheckProviderKind() === 'recaptcha-enterprise'
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new ReCaptchaV3Provider(siteKey)
  appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true })
  return appCheck
}

/**
 * The App Check token to send as `X-Firebase-AppCheck`. A limited-use token is minted
 * fresh for one request and consumed by the server, so it cannot be replayed; use it for
 * irreversible or money-moving actions.
 */
export async function appCheckToken({ limitedUse = false } = {}): Promise<string | null> {
  const instance = ensureAppCheck()
  if (!instance) return null
  const result = limitedUse ? await getLimitedUseToken(instance) : await getToken(instance)
  return result.token
}

export const firebaseEnabled = hasConfig
export { app, auth, db, googleProvider }
