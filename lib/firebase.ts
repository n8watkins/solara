// The app's only way to Firebase. The SDK (Auth, Firestore, App Check) is about
// 200 KB gzip of JavaScript and starts a third-party iframe, so it is not part of the
// app's first load: lib/firebase-services.ts starts it, and loadFirebase() loads that
// module on demand - when someone signs in, or at start-up when this browser already
// holds a session (storedSessionHint, storedSessionInIndexedDb). A guest never
// downloads it. This module itself imports nothing from the SDK at runtime.
import { ACCOUNT_OWNER_KEY } from './app-routes'
import type * as Services from './firebase-services'

export type FirebaseServices = typeof Services

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

/** Whether this build has a Firebase project, so accounts and sign-in exist at all. */
export const firebaseEnabled = !!(API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)

let pending: Promise<FirebaseServices> | null = null
let loaded: FirebaseServices | null = null
const loadListeners = new Set<(services: FirebaseServices) => void>()

/**
 * Loads and starts Firebase, once. Resolves to null in a build without Firebase or
 * on the server. Rejects if the chunk cannot be loaded (offline, or a deploy in
 * between); the next call tries again.
 */
export function loadFirebase(): Promise<FirebaseServices | null> {
  if (!firebaseEnabled || typeof window === 'undefined') return Promise.resolve(null)
  pending ??= import('./firebase-services').then(
    services => {
      loaded = services
      for (const listener of loadListeners) listener(services)
      return services
    },
    error => {
      pending = null
      throw error
    },
  )
  return pending
}

/**
 * Starts loading Firebase in the background, for a sign-in that is about to happen,
 * with Auth's sign-in popup helper (prepareSignInPopup in lib/firebase-services.ts).
 */
export function preloadFirebase(): void {
  loadFirebase().then(
    services => services?.prepareSignInPopup(),
    () => {},
  )
}

/** The started SDK if it has loaded, else null. Never starts loading it. */
export function loadedFirebase(): FirebaseServices | null {
  return loaded
}

/**
 * Calls `listener` once Firebase has loaded (right away if it already has), whoever
 * loaded it. Returns a function that stops listening.
 */
export function whenFirebaseLoads(listener: (services: FirebaseServices) => void): () => void {
  if (loaded) {
    listener(loaded)
    return () => {}
  }
  loadListeners.add(listener)
  return () => loadListeners.delete(listener)
}

/**
 * Starts a subscription that needs the SDK and returns, right away, the function that
 * stops it, which also works before the subscription has started. `start` returns
 * the subscription's own unsubscribe, or null when there is nothing to subscribe to.
 */
export function lazySubscription(
  start: () => Promise<(() => void) | null>,
  onError: (error: unknown) => void,
): () => void {
  let stop: (() => void) | null = null
  let stopped = false
  start().then(
    unsubscribe => {
      if (stopped) unsubscribe?.()
      else stop = unsubscribe
    },
    error => {
      if (!stopped) onError(error)
    },
  )
  return () => {
    stopped = true
    stop?.()
    stop = null
  }
}

// ---- Is someone signed in? ----------------------------------------------------------

/** Where Firebase Auth persists the signed-in user (key and IndexedDB layout). */
const AUTH_USER_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`
const AUTH_DB = 'firebaseLocalStorageDb'
const AUTH_STORE = 'firebaseLocalStorage'

/**
 * Whether this browser holds a Solara session, answered synchronously: the account
 * marker every sign-in writes (lib/session.ts), or the user Firebase Auth keeps in
 * localStorage when IndexedDB is unavailable.
 */
export function storedSessionHint(): boolean {
  if (!firebaseEnabled) return false
  try {
    return !!(localStorage.getItem(ACCOUNT_OWNER_KEY) || localStorage.getItem(AUTH_USER_KEY))
  } catch {
    return false
  }
}

/** The signed-in user Firebase Auth keeps in this browser, as much of it as the app shows. */
export interface StoredSessionUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

function sessionUserFrom(value: unknown): StoredSessionUser | null {
  if (typeof value !== 'object' || value === null) return null
  const user = value as Record<string, unknown>
  if (typeof user.uid !== 'string' || !user.uid) return null
  const text = (field: unknown) => (typeof field === 'string' ? field : null)
  return {
    uid: user.uid,
    displayName: text(user.displayName),
    email: text(user.email),
    photoURL: text(user.photoURL),
  }
}

/**
 * The user Firebase Auth keeps in its own IndexedDB store, or null. Never creates the
 * database, and answers null on any error.
 */
function indexedDbUser(): Promise<unknown> {
  if (!firebaseEnabled || typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(AUTH_DB)
      // The database does not exist yet: abort, so it is not created empty.
      request.onupgradeneeded = () => request.transaction?.abort()
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
      request.onsuccess = () => {
        const database = request.result
        try {
          if (!database.objectStoreNames.contains(AUTH_STORE)) {
            database.close()
            resolve(null)
            return
          }
          const read = database.transaction(AUTH_STORE, 'readonly').objectStore(AUTH_STORE)
          const get = read.get(AUTH_USER_KEY)
          get.onsuccess = () => {
            database.close()
            resolve((get.result as { value?: unknown } | undefined)?.value ?? null)
          }
          get.onerror = () => {
            database.close()
            resolve(null)
          }
        } catch {
          database.close()
          resolve(null)
        }
      }
    } catch {
      resolve(null)
    }
  })
}

/**
 * Whether Firebase Auth's own IndexedDB store holds a signed-in user: the backstop for a
 * session without the account marker (its localStorage was cleared). Never creates the
 * database, and answers false on any error.
 */
export async function storedSessionInIndexedDb(): Promise<boolean> {
  return (await indexedDbUser()) != null
}

/**
 * The user of the session Firebase Auth keeps in this browser (in IndexedDB, or in
 * localStorage where IndexedDB is unavailable), without loading Firebase, or null.
 * Auth still has to confirm the session: this is what the browser holds, not proof.
 */
export async function storedSessionUser(): Promise<StoredSessionUser | null> {
  if (!firebaseEnabled) return null
  try {
    const stored = localStorage.getItem(AUTH_USER_KEY)
    if (stored) return sessionUserFrom(JSON.parse(stored))
  } catch {}
  return sessionUserFrom(await indexedDbUser())
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

/**
 * The App Check token to send as `X-Firebase-AppCheck` (see appCheckToken in
 * lib/firebase-services.ts), or null when App Check is not available.
 */
export async function appCheckToken({ limitedUse = false } = {}): Promise<string | null> {
  const services = await loadFirebase()
  return services ? services.appCheckToken({ limitedUse }) : null
}
