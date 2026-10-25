// The Firebase SDK, started: the app, Auth, Firestore and (after sign-in) App Check.
// Loaded only through loadFirebase() in lib/firebase.ts, as a chunk of its own that
// a guest never downloads. It is the only module that imports the SDK statically;
// everything else gets these instances from loadFirebase() and the SDK's functions
// with `await import('firebase/...')`, which eslint.config.mjs enforces.
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
import type { Auth, PopupRedirectResolver } from 'firebase/auth'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
} from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore'
import { appCheckProviderKind, firebaseEnabled } from './firebase'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let googleProvider: GoogleAuthProvider | null = null

if (firebaseEnabled) {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }

  const existing = getApps()[0]
  app = existing ?? initializeApp(firebaseConfig)
  // getAuth() without its popup and redirect helper: getAuth() starts that helper (an
  // iframe from the auth domain and Google's scripts) at start-up on phones and in
  // Safari, which a session that is already signed in never needs. Sign-in starts it
  // instead (prepareSignInPopup) and passes it to signInWithPopup. The persistence
  // list is getAuth()'s own, so stored sessions are found exactly as before.
  auth = existing
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
        ],
      })
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

// ---- Sign-in popup ---------------------------------------------------------------

/** What signInWithPopup needs for the Google sign-in popup (Auth's popup helper). */
export const popupRedirectResolver: PopupRedirectResolver = browserPopupRedirectResolver

let popupReady: Promise<unknown> | null = null

/**
 * Starts Auth's popup helper ahead of a sign-in (when a sign-in button shows or the
 * pointer reaches it), as getAuth() would at start-up, so the popup still opens within
 * the click's user activation. getRedirectResult is the public way to start it; the
 * app never signs in with a redirect, so there is never a result to take.
 */
export function prepareSignInPopup(): void {
  if (!auth || typeof window === 'undefined') return
  popupReady ??= getRedirectResult(auth, popupRedirectResolver).catch(() => null)
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

export { app, auth, db, googleProvider }
