'use client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { cachedAccount } from './cached-account'
import {
  loadedFirebase,
  loadFirebase,
  storedSessionHint,
  storedSessionInIndexedDb,
  whenFirebaseLoads,
  type StoredSessionUser,
} from './firebase'
import { loadGuestPrefs } from './guest'
import { saveLocalPrefs } from './prefs'
import { useForecastStore } from './use-forecast'
import {
  ACCOUNT_LOAD_ERROR,
  accountErrorMessage,
  screenWhenNeedsOnboarding,
  screenWhenSignedOut,
  type AppScreen,
} from './account-screen'
import type { AccountLoadResult } from './session'
import type { UserPreferences } from './types'

/** How long a stored session's start-up waits for the signed-in parts before Auth. */
const SIGNED_IN_PARTS_WAIT_MS = 3000

/**
 * Loads the signed-in account (loadAccountPrefs in lib/session.ts). The account code,
 * and the notifications code it uses, loads only for someone signed in; a failure to
 * load it is a failed account load.
 */
async function loadSignedInAccount(
  uid: string,
  known: UserPreferences | null,
): Promise<AccountLoadResult> {
  try {
    const { loadAccountPrefs } = await import('./session')
    return await loadAccountPrefs(uid, known)
  } catch (error) {
    return {
      status: 'error',
      stage: 'load',
      error: error instanceof Error ? error : new Error('Could not load the account'),
    }
  }
}

/** Resolves once the browser reports a network connection (at once if it does). */
function whenOnline(): Promise<void> {
  if (navigator.onLine !== false) return Promise.resolve()
  return new Promise(resolve => window.addEventListener('online', () => resolve(), { once: true }))
}

/**
 * The account (or guest) behind components/App.tsx: follows Firebase Auth, loads (or
 * creates) the account's preferences or the guest plan kept in this browser, and
 * picks the top-level screen.
 *
 * Firebase loads only for a session this browser already holds, or once someone
 * starts signing in (lib/firebase.ts). Until then the visitor is signed out, so a
 * guest's plan and cached forecast show without waiting for it. For a session this
 * browser holds, the account's dashboard shows at once from this browser's copy of it
 * (lib/cached-account.ts) while Firebase loads, Auth confirms the session and the saved
 * account loads; until then `pending` names the account and the app accepts no input.
 * `prepareSignedIn` loads what the signed-in screen needs before that first paint.
 *
 * `onAccountReset` runs whenever the plan on screen goes away (sign-in from guest
 * mode, sign-out or a switch to another account), so the caller can drop per-account
 * view state; the cached forecasts are dropped here. `reload` loads the current
 * account again, using `signedIn` (the account document that sign-in just read or
 * created) if given. `signInRequested` shows the sign-in screen to a signed-out
 * visitor on the first load.
 */
export function useAccount({
  onAccountReset,
  signInRequested = false,
  prepareSignedIn,
}: {
  onAccountReset: () => void
  signInRequested?: boolean
  prepareSignedIn?: () => Promise<void>
}) {
  const forecasts = useForecastStore()
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [accountError, setAccountError] = useState<string | null>(null)
  // The account shown from this browser's copy until its session and plan have loaded.
  const [pending, setPending] = useState<StoredSessionUser | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The account whose data is on screen, to detect a switch to a different account.
  const accountUid = useRef<string | null>(null)
  // The account document that sign-in from setup just read or created, for the next load.
  const signedInAccount = useRef<UserPreferences | null>(null)
  // Starts Firebase once the account shown from this browser's copy has painted.
  const startFirebaseAfterPaint = useRef<(() => void) | null>(null)

  const resetAccountState = useEffectEvent(() => {
    // Drops cached forecasts and aborts any request in flight.
    forecasts.clear()
    setPrefs(null)
    onAccountReset()
  })

  useEffect(() => {
    // Auth events can arrive while a previous account is still loading. Each event
    // gets a generation number, and results for an older one are dropped.
    let generation = 0
    let disposed = false
    // Set when this run is the reload after sign-in from setup.
    let signedIn = signedInAccount.current
    signedInAccount.current = null
    const requested = signInRequested

    // Set while the account from this browser's copy is on screen (see cachedAccount).
    let showingCached = false

    async function loadAccount(u: User | null, current: number) {
      const isStale = () => disposed || current !== generation
      const previousUid = accountUid.current
      const wasCached = showingCached
      accountUid.current = u?.uid ?? null
      setUser(u)
      setAccountError(null)
      const settle = () => {
        showingCached = false
        setPending(null)
      }

      // Signed out: the guest plan kept in this browser, if any. It lives apart from
      // any account's data (lib/guest.ts), so a guest never sees an account's plan.
      if (!u) {
        // Drop the previous account's state so a later sign-in can never show it.
        if (previousUid) resetAccountState()
        settle()
        const guest = loadGuestPrefs()
        setPrefs(guest)
        setScreen(prev =>
          // The session shown from this browser's copy has ended: as from a fresh start.
          screenWhenSignedOut(wasCached ? 'loading' : prev, {
            hasGuestPlan: !!guest,
            signInRequested: requested,
          }),
        )
        return
      }
      if (previousUid !== u.uid) {
        // A different account, or a guest who just signed in: nothing on screen may be
        // saved to this account until its own plan has loaded.
        resetAccountState()
        settle()
        setScreen('loading')
      }

      // Offline, the account shown from this browser's copy stays on screen, read-only
      // with its cached forecast (components/OfflineNotice.tsx), and its saved plan
      // loads once the browser is back online instead of failing.
      if (wasCached && previousUid === u.uid) {
        await whenOnline()
        if (isStale()) return
      }

      const known = signedIn
      signedIn = null
      const result = await loadSignedInAccount(u.uid, known)
      if (isStale()) return
      settle()
      if (result.status === 'error') {
        console.error('Account load failed:', result.error)
        setAccountError(accountErrorMessage(result.stage))
        setScreen('loading')
        return
      }
      if (result.status === 'needs-onboarding') {
        // The account this browser had a copy of no longer exists: drop the copy too.
        if (wasCached) resetAccountState()
        setScreen(prev => screenWhenNeedsOnboarding(wasCached ? 'loading' : prev))
        return
      }

      const loaded = result.prefs
      setPrefs(loaded)
      setScreen('dashboard')
      // This browser's copy, for the next start (lib/cached-account.ts).
      saveLocalPrefs({ ...loaded, uid: u.uid })
      if (loaded.tier === 'paid') {
        import('./notifications')
          .then(async notifications => {
            await notifications.migrateLegacyNotificationToken(u.uid)
            if (notifications.notificationsEnabledLocally(u.uid)) {
              await notifications.enableNotifications(u.uid)
            }
          })
          .catch(err => console.error('Notification refresh failed:', err))
      }
    }

    function handleAuth(u: User | null) {
      generation += 1
      void loadAccount(u, generation)
    }

    let stopWaitingForNetwork: (() => void) | null = null

    // Follow Auth from whenever Firebase loads: now for a stored session, or later
    // when a sign-in button loads it.
    let unsubscribeAuth: (() => void) | null = null
    const stopWaiting = whenFirebaseLoads(({ auth }) => {
      if (!auth) return
      void import('firebase/auth').then(({ onAuthStateChanged }) => {
        if (!disposed) unsubscribeAuth = onAuthStateChanged(auth, handleAuth)
      })
    })

    if (loadedFirebase()) {
      // Auth's listener, just attached, reports the current user.
    } else if (storedSessionHint()) {
      let started = false
      const startFirebase = () => {
        if (started || disposed) return
        // Offline, Firebase loads once the browser is back online, so the account shown
        // from this browser's copy is never replaced by a failed download.
        if (showingCached && navigator.onLine === false) {
          window.addEventListener('online', startFirebase, { once: true })
          stopWaitingForNetwork = () => window.removeEventListener('online', startFirebase)
          return
        }
        started = true
        loadFirebase().catch(error => {
          if (disposed) return
          console.error('Account load failed:', error)
          showingCached = false
          setPending(null)
          setAccountError(ACCOUNT_LOAD_ERROR)
          setScreen('loading')
        })
      }
      // The account as this browser last saw it shows first, and Firebase starts once
      // it has painted (the effect below), so the SDK's download and start-up never
      // hold up the dashboard. Without one, Firebase starts at once.
      startFirebaseAfterPaint.current = startFirebase
      void cachedAccount().then(async cached => {
        if (!cached) return startFirebase()
        // Should the signed-in parts be slow to arrive, Auth need not wait for them.
        const fallback = setTimeout(startFirebase, SIGNED_IN_PARTS_WAIT_MS)
        await prepareSignedIn?.()
        clearTimeout(fallback)
        if (disposed || started) return startFirebase()
        showingCached = true
        accountUid.current = cached.identity.uid
        setPrefs(cached.prefs)
        setPending(cached.identity)
        setScreen('dashboard')
      })
    } else {
      // Signed out until Auth says otherwise: no waiting for Firebase.
      handleAuth(null)
      // A session without the account marker (its localStorage was cleared) still
      // signs in, a moment later.
      void storedSessionInIndexedDb().then(found => {
        if (found && !disposed) loadFirebase().catch(() => {})
      })
    }
    return () => {
      disposed = true
      startFirebaseAfterPaint.current = null
      stopWaitingForNetwork?.()
      stopWaiting()
      unsubscribeAuth?.()
    }
    // signInRequested only matters for the first signed-out load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  // The cached dashboard has rendered; Firebase starts once the browser has shown it
  // (the frame after next), so not even the request for the SDK competes with it.
  useEffect(() => {
    if (!pending) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => startFirebaseAfterPaint.current?.())
    })
    return () => cancelAnimationFrame(frame)
  }, [pending])

  return {
    user,
    pending,
    prefs,
    setPrefs,
    screen,
    setScreen,
    accountError,
    reload: (signedIn: UserPreferences | null = null) => {
      signedInAccount.current = signedIn
      setReloadKey(key => key + 1)
    },
    /** Leaves the sign-in screen for the guest plan, or for setup without one. */
    continueAsGuest: () => {
      const guest = loadGuestPrefs()
      setPrefs(guest)
      setScreen(guest ? 'dashboard' : 'onboarding')
    },
  }
}
