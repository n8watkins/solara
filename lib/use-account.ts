'use client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { loadAccountPrefs } from './session'
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
 * The signed-in account behind components/App.tsx: follows Firebase Auth, loads
 * (or creates) the account's preferences, and picks the top-level screen.
 *
 * `onAccountReset` runs whenever the account on screen goes away (sign-out or a
 * switch to another account), so the caller can drop per-account view state; the
 * cached forecasts are dropped here. `reload` loads the current account again.
 */
export function useAccount({ onAccountReset }: { onAccountReset: () => void }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The account whose data is on screen, to detect a switch to a different account.
  const accountUid = useRef<string | null>(null)

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

    async function loadAccount(u: User | null, current: number) {
      const isStale = () => disposed || current !== generation
      const previousUid = accountUid.current
      accountUid.current = u?.uid ?? null
      setUser(u)
      setAccountError(null)

      // Sign-in with Google is required to use Solara - a guest never reaches the
      // dashboard. No local-prefs fallback into the app for signed-out visitors.
      if (!u) {
        // Drop the previous account's state so a later sign-in can never show it.
        resetAccountState()
        setScreen(screenWhenSignedOut)
        return
      }
      if (previousUid && previousUid !== u.uid) {
        resetAccountState()
        setScreen('loading')
      }

      const result = await loadAccountPrefs(u.uid)
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
  }, [reloadKey])

  return {
    user,
    prefs,
    setPrefs,
    screen,
    setScreen,
    accountError,
    reload: () => setReloadKey(key => key + 1),
  }
}
