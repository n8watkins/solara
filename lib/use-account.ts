'use client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { loadAccountPrefs } from './session'
import { loadGuestPrefs } from './guest'
import { FORECAST_QUERY_KEY } from './use-forecast'
import {
  enableNotifications,
  migrateLegacyNotificationToken,
  notificationsEnabledLocally,
} from './notifications'
import {
  accountErrorMessage,
  screenWhenNeedsOnboarding,
  screenWhenSignedOut,
  type AppScreen,
} from './account-screen'
import type { UserPreferences } from './types'

/**
 * The account (or guest) behind components/App.tsx: follows Firebase Auth, loads (or
 * creates) the account's preferences or the guest plan kept in this browser, and
 * picks the top-level screen.
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
}: {
  onAccountReset: () => void
  signInRequested?: boolean
}) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The account whose data is on screen, to detect a switch to a different account.
  const accountUid = useRef<string | null>(null)
  // The account document that sign-in from setup just read or created, for the next load.
  const signedInAccount = useRef<UserPreferences | null>(null)

  const resetAccountState = useEffectEvent(() => {
    // Drops cached forecasts and aborts any request in flight.
    queryClient.removeQueries({ queryKey: FORECAST_QUERY_KEY })
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

    async function loadAccount(u: User | null, current: number) {
      const isStale = () => disposed || current !== generation
      const previousUid = accountUid.current
      accountUid.current = u?.uid ?? null
      setUser(u)
      setAccountError(null)

      // Signed out: the guest plan kept in this browser, if any. It lives apart from
      // any account's data (lib/guest.ts), so a guest never sees an account's plan.
      if (!u) {
        // Drop the previous account's state so a later sign-in can never show it.
        if (previousUid) resetAccountState()
        const guest = loadGuestPrefs()
        setPrefs(guest)
        setScreen(prev =>
          screenWhenSignedOut(prev, { hasGuestPlan: !!guest, signInRequested: requested }),
        )
        return
      }
      if (previousUid !== u.uid) {
        // A different account, or a guest who just signed in: nothing on screen may be
        // saved to this account until its own plan has loaded.
        resetAccountState()
        setScreen('loading')
      }

      const known = signedIn
      signedIn = null
      const result = await loadAccountPrefs(u.uid, known)
      if (isStale()) return
      if (result.status === 'error') {
        console.error('Account load failed:', result.error)
        setAccountError(accountErrorMessage(result.stage))
        setScreen('loading')
        return
      }
      if (result.status === 'needs-onboarding') {
        setScreen(screenWhenNeedsOnboarding)
        return
      }

      const loaded = result.prefs
      setPrefs(loaded)
      setScreen('dashboard')
      if (loaded.tier === 'paid') {
        migrateLegacyNotificationToken(u.uid)
          .then(() => {
            if (notificationsEnabledLocally(u.uid)) return enableNotifications(u.uid)
          })
          .catch(err => console.error('Notification refresh failed:', err))
      }
    }

    function handleAuth(u: User | null) {
      generation += 1
      void loadAccount(u, generation)
    }

    if (auth) {
      const unsub = onAuthStateChanged(auth, handleAuth)
      return () => {
        disposed = true
        unsub()
      }
    }
    handleAuth(null)
    return () => {
      disposed = true
    }
    // signInRequested only matters for the first signed-out load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  return {
    user,
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
