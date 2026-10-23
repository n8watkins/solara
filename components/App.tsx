'use client'
import { useEffect, useRef, useState } from 'react'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { saveLocalPrefs, saveFirestorePrefs } from '@/lib/prefs'
import { loadAccountPrefs } from '@/lib/session'
import { FORECAST_QUERY_KEY, createQueryClient, useWeather } from '@/lib/use-forecast'
import { resolveUnits, unitFormatters } from '@/lib/units'
import { UnitsContext } from '@/lib/use-units'
import {
  enableNotifications,
  migrateLegacyNotificationToken,
  notificationsEnabledLocally,
  onForegroundMessage,
} from '@/lib/notifications'
import { observeCheckoutResult } from '@/lib/billing'
import type { UserPreferences, TierLevel, DayWeather } from '@/lib/types'
import Welcome from './Welcome'
import Onboarding from './Onboarding'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import InstallPrompt from './InstallPrompt'
import CalendarView from './CalendarView'
import DevPanel from './DevPanel'
import ErrorBoundary from './ErrorBoundary'
import AppShell, { type AppView } from './AppShell'

type Screen = 'loading' | 'welcome' | 'onboarding' | 'dashboard'

const ACCOUNT_LOAD_ERROR =
  'Could not load your saved account. Nothing was changed. Check your connection and try again.'
const ACCOUNT_CREATE_ERROR =
  'Could not finish setting up your account. Nothing was saved. Check your connection and try again.'

export default function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <SignedInApp />
    </QueryClientProvider>
  )
}

function SignedInApp() {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<UserPreferences | null>(null)
  const [screen, setScreen] = useState<Screen>('loading')
  const [view, setView] = useState<AppView>('dashboard')
  const [selectedDay, setSelectedDay] = useState<DayWeather | null>(null)
  const [tierOverride, setTierOverride] = useState<TierLevel | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefsTab] = useState<'general' | 'activities' | 'location'>('general')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [authReloadKey, setAuthReloadKey] = useState(0)
  const [foregroundNotice, setForegroundNotice] = useState(false)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  // The account whose data is on screen, to detect a switch to a different account.
  const accountUid = useRef<string | null>(null)
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    // Auth events can arrive while a previous account is still loading. Each event
    // gets a generation number, and results for an older one are dropped.
    let generation = 0
    let disposed = false

    function resetAccountState() {
      // Drops cached forecasts and aborts any request in flight.
      queryClient.removeQueries({ queryKey: FORECAST_QUERY_KEY })
      setPrefs(null)
      setSyncError(null)
      setBillingNotice(null)
      setForegroundNotice(false)
      setSelectedDay(null)
      setView('dashboard')
    }

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
        setScreen(prev => (prev === 'onboarding' ? prev : 'welcome'))
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
        setAccountError(result.stage === 'create' ? ACCOUNT_CREATE_ERROR : ACCOUNT_LOAD_ERROR)
        setScreen('loading')
        return
      }
      if (result.status === 'needs-onboarding') {
        // Signed in but no prefs yet (mid-onboarding): keep onboarding visible, and
        // keep the dashboard if onboarding already finished while this was loading.
        setScreen(prev => (prev === 'onboarding' || prev === 'dashboard' ? prev : 'welcome'))
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
  }, [authReloadKey, queryClient])

  useEffect(() => {
    if (!user) return
    return onForegroundMessage(() => setForegroundNotice(true))
  }, [user])

  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'canceled') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
      setBillingNotice('Checkout was canceled. You were not charged.')
      return
    }
    if (params.get('checkout') !== 'success') return
    const sessionId = params.get('session_id')
    if (!sessionId) {
      setBillingNotice('Checkout returned successfully. Refresh to confirm your subscription.')
      return
    }

    setBillingNotice('Confirming your subscription...')
    const clearCheckoutQuery = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('checkout')
      url.searchParams.delete('session_id')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
    return observeCheckoutResult(
      user.uid,
      sessionId,
      result => {
        if (result.status === 'waiting') return
        if (result.status === 'pending') {
          setBillingNotice(
            'Your payment is still processing. Pro will activate automatically when it completes.',
          )
          return
        }
        clearCheckoutQuery()
        if (result.status === 'failed') {
          setBillingNotice('Your payment did not complete. You can try again from the Pro plans.')
          return
        }
        setPrefs(result.prefs)
        saveLocalPrefs(result.prefs)
        setBillingNotice('Pro is active on your account.')
      },
      () =>
        setBillingNotice('Could not confirm your subscription. Check your connection and refresh.'),
    )
  }, [user])

  // The forecast for the active location. Switching location aborts the old
  // request; a cached forecast shows at once while a stale one refreshes; "today"
  // and "now" come from the location's time zone.
  const {
    weather,
    loading: weatherLoading,
    error,
    refresh: refreshWeather,
  } = useWeather(screen === 'dashboard' ? prefs?.location : null)
  const units = unitFormatters(resolveUnits(prefs))

  async function handlePrefsUpdate(updated: UserPreferences) {
    setPrefs(updated)
    setSyncError(null)
    if (user) {
      saveLocalPrefs({ ...updated, uid: user.uid })
      try {
        await saveFirestorePrefs(user.uid, updated)
      } catch {
        setSyncError(
          'Saved on this device, but cloud sync failed. Retry when your connection returns.',
        )
      }
    }
  }

  function handleOnboardingComplete(p: UserPreferences) {
    // Onboarding stores its answers unowned; tie them to the account that just
    // signed in so a different account on this browser never reuses them.
    const uid = auth?.currentUser?.uid
    const owned = uid ? { ...p, uid } : p
    if (uid) saveLocalPrefs(owned)
    setPrefs(owned)
    setScreen('dashboard')
  }

  if (screen === 'loading') {
    if (accountError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '440px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>☁️</div>
            <h1 style={{ margin: '0 0 8px', fontSize: '20px', color: 'var(--text)' }}>
              Your account could not load
            </h1>
            <p
              role="alert"
              style={{
                margin: '0 0 18px',
                color: 'var(--text-2)',
                fontSize: '14px',
                lineHeight: 1.5,
              }}
            >
              {accountError}
            </p>
            <button className="btn btn-primary" onClick={() => setAuthReloadKey(key => key + 1)}>
              Try again
            </button>
          </div>
        </div>
      )
    }
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>☀️</div>
          <p style={{ color: 'var(--text-3)', fontSize: '14px' }}>Loading...</p>
        </div>
      </div>
    )
  }

  if (screen === 'welcome') {
    return <Welcome onGetStarted={() => setScreen('onboarding')} />
  }

  if (screen === 'onboarding' || !prefs?.location) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  const displayTier = tierOverride || prefs.tier || 'anonymous'
  // Guests only get the dashboard - no calendar tab bar, and never a stale
  // 'calendar' view (e.g. right after signing out). Derived rather than reset in
  // the auth listener because DevPanel's tierOverride flips displayTier without an
  // auth event. EVERY render decision below must key off effectiveView, never `view`.
  const effectiveView = displayTier === 'anonymous' ? 'dashboard' : view

  return (
    <UnitsContext value={units}>
      <AppShell
        header={
          <Header
            user={user}
            prefs={prefs}
            displayTier={displayTier}
            onPrefsUpdate={p => void handlePrefsUpdate(p)}
            forceOpenTab={prefsOpen ? prefsTab : undefined}
            onModalClose={() => setPrefsOpen(false)}
            onGoHome={() => {
              setView('dashboard')
              setSelectedDay(null)
            }}
            currentUV={weather?.current.uv}
          />
        }
        view={effectiveView}
        onViewChange={displayTier !== 'anonymous' ? setView : undefined}
        after={isDev && <DevPanel currentTier={displayTier} onOverride={setTierOverride} />}
      >
        <InstallPrompt />
        {foregroundNotice && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'var(--notice-bg)',
              border: '0.5px solid var(--notice-border)',
              marginBottom: '16px',
              fontSize: '14px',
              color: 'var(--notice-text)',
            }}
          >
            <span>🔔</span>
            <span style={{ flex: 1 }}>Your latest local-morning planning summary is ready.</span>
            <button
              className="btn"
              onClick={() => setForegroundNotice(false)}
              style={{ fontSize: '12px' }}
            >
              Dismiss
            </button>
          </div>
        )}
        {billingNotice && (
          <div
            role="status"
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: '#EFF6FF',
              border: '0.5px solid #BFDBFE',
              marginBottom: '16px',
              fontSize: '14px',
              color: '#1E40AF',
            }}
          >
            {billingNotice}
          </div>
        )}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '12px',
              background: '#FEF2F2',
              border: '0.5px solid #FECACA',
              marginBottom: '16px',
              fontSize: '14px',
              color: '#991B1B',
            }}
          >
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button className="btn" onClick={refreshWeather} style={{ fontSize: '12px' }}>
              Retry
            </button>
          </div>
        )}
        {syncError && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'var(--notice-bg)',
              border: '0.5px solid var(--notice-border)',
              marginBottom: '16px',
              fontSize: '14px',
              color: 'var(--notice-text)',
            }}
          >
            <span>☁️</span>
            <span style={{ flex: 1 }}>{syncError}</span>
            <button
              className="btn"
              onClick={() => void handlePrefsUpdate(prefs)}
              style={{ fontSize: '12px' }}
            >
              Retry sync
            </button>
          </div>
        )}
        {effectiveView === 'dashboard' && (
          <>
            {weatherLoading && <Skeleton />}
            {weather && (
              <ErrorBoundary label="the dashboard" onReset={refreshWeather}>
                <Dashboard
                  weather={weather}
                  prefs={prefs}
                  displayTier={displayTier}
                  onPrefsUpdate={p => void handlePrefsUpdate(p)}
                  onRefresh={refreshWeather}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                />
              </ErrorBoundary>
            )}
          </>
        )}
        {effectiveView === 'calendar' && (weather || weatherLoading) && (
          <div className="card">
            {weather ? (
              <ErrorBoundary label="the calendar" onReset={refreshWeather}>
                <CalendarView
                  prefs={prefs}
                  displayTier={displayTier}
                  weather={weather}
                  onPrefsUpdate={p => void handlePrefsUpdate(p)}
                />
              </ErrorBoundary>
            ) : (
              <p
                role="status"
                style={{
                  padding: '3rem 0',
                  margin: 0,
                  textAlign: 'center',
                  fontSize: '14px',
                  color: 'var(--text-3)',
                }}
              >
                Loading forecast…
              </p>
            )}
          </div>
        )}
      </AppShell>
    </UnitsContext>
  )
}
