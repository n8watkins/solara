import type { FirebaseApp } from 'firebase/app'
import { initializeApp, getApps } from 'firebase/app'
import type { AppCheck } from 'firebase/app-check'
import {
  getLimitedUseToken,
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from 'firebase/app-check'
import type { Auth } from 'firebase/auth'
import { getAuth, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { initializeFirestore } from 'firebase/firestore'

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

  // App Check loads reCAPTCHA, a third-party script, so it starts only once someone signs
  // in. Every App Check-protected request (Cloud Functions, and Firestore if enforcement
  // is turned on) happens after sign-in.
  if (typeof window !== 'undefined') {
    onAuthStateChanged(auth, user => {
      if (user) ensureAppCheck()
    })
  }
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
  return !!process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY
}

let appCheck: AppCheck | null = null

/** Initializes App Check once, on demand. Returns null when unconfigured or server-side. */
export function ensureAppCheck(): AppCheck | null {
  if (appCheck) return appCheck
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
