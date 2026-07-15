'use client'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { loadLocalPrefs, loadFirestorePrefs, defaultPrefs, saveLocalPrefs, saveFirestorePrefs } from '@/lib/prefs'
import { getCachedWeather, setCachedWeather } from '@/lib/cache'
import { fetchForecast } from '@/lib/forecast'
import { enableNotifications, migrateLegacyNotificationToken, notificationsEnabledLocally, onForegroundMessage } from '@/lib/notifications'
import { observeCheckoutResult } from '@/lib/billing'
import { UserPreferences, WeatherResponse, Location, TierLevel, DayWeather } from '@/lib/types'
import Welcome from './Welcome'
import Onboarding from './Onboarding'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import NotificationBanner from './NotificationBanner'
import InstallPrompt from './InstallPrompt'
import CalendarView from './CalendarView'
import DevPanel from './DevPanel'
import ErrorBoundary from './ErrorBoundary'

type Screen = 'loading' | 'welcome' | 'onboarding' | 'dashboard'

export default function App() {
  const [user,           setUser]           = useState<User | null>(null)
  const [prefs,          setPrefs]          = useState<UserPreferences | null>(null)
  const [weather,        setWeather]        = useState<WeatherResponse | null>(null)
  const [screen,         setScreen]         = useState<Screen>('loading')
  const [view,           setView]           = useState<'dashboard' | 'calendar'>('dashboard')
  const [selectedDay,    setSelectedDay]    = useState<DayWeather | null>(null)
  const [tierOverride,   setTierOverride]   = useState<TierLevel | null>(null)
  const [prefsOpen,      setPrefsOpen]      = useState(false)
  const [prefsTab,       setPrefsTab]       = useState<'general' | 'activities' | 'location'>('general')
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [accountError,   setAccountError]   = useState<string | null>(null)
  const [syncError,      setSyncError]      = useState<string | null>(null)
  const [authReloadKey,  setAuthReloadKey]  = useState(0)
  const [showNotif,      setShowNotif]      = useState(false)
  const [foregroundNotice, setForegroundNotice] = useState(false)
  const [billingNotice, setBillingNotice] = useState<string | null>(null)
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    async function loadPrefs(u: User | null) {
      setUser(u)
      setAccountError(null)

      // Sign-in with Google is required to use Solara — a guest never reaches the
      // dashboard. No local-prefs fallback into the app for signed-out visitors.
      if (!u) {
        // Clear the previous account's state so a later sign-in can never momentarily
        // show stale prefs/weather (e.g. if a Firestore read transiently fails).
        setPrefs(null)
        setWeather(null)
        setScreen(prev => (prev === 'onboarding' ? prev : 'welcome'))
        return
      }

      const result = await loadFirestorePrefs(u.uid)
      if (result.status === 'error') {
        setAccountError('Could not load your saved account. Nothing was changed. Check your connection and try again.')
        setScreen('loading')
        return
      }

      let loaded = result.status === 'found' ? result.prefs : null
      if (result.status === 'missing') {
        // Brand-new account: seed from the prefs gathered during onboarding, if any.
        const local = loadLocalPrefs()
        if (local?.location) {
          loaded = {
            ...defaultPrefs(local.location as Location),
            ...local,
            uid: u.uid,
            tier: local.tier && local.tier !== 'anonymous' ? local.tier : 'free',
          }
          await saveFirestorePrefs(u.uid, loaded)
        }
      }

      if (loaded) {
        setPrefs(loaded)
        setScreen('dashboard')
        if (loaded.tier === 'paid') {
          migrateLegacyNotificationToken(u.uid)
            .then(() => {
              if (notificationsEnabledLocally(u.uid)) return enableNotifications(u.uid)
            })
            .catch(err => console.error('Notification refresh failed:', err))
        }
        if (loaded.tier === 'paid' && 'Notification' in window && Notification.permission === 'default' && !notificationsEnabledLocally(u.uid)) {
          setTimeout(() => setShowNotif(true), 4000)
        }
      } else {
        // Signed in but no prefs yet (mid-onboarding) — keep onboarding visible.
        setScreen(prev => (prev === 'onboarding' ? prev : 'welcome'))
      }
    }

    if (auth) {
      const unsub = onAuthStateChanged(auth, loadPrefs)
      return () => unsub()
    } else {
      loadPrefs(null)
    }
  }, [authReloadKey])

  useEffect(() => {
    if (!user) return
    return onForegroundMessage(() => setForegroundNotice(true))
  }, [user])

  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'canceled') {
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
    return observeCheckoutResult(user.uid, sessionId, result => {
      if (result.status === 'waiting') return
      if (result.status === 'pending') {
        setBillingNotice('Your payment is still processing. Pro will activate automatically when it completes.')
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
    }, () => setBillingNotice('Could not confirm your subscription. Check your connection and refresh.'))
  }, [user])

  useEffect(() => {
    if (prefs?.location && screen === 'dashboard') {
      fetchWeather(prefs.location)
    }
  }, [prefs?.location?.lat, prefs?.location?.lon, screen])

  async function fetchWeather(location: Location, force = false) {
    if (!force) {
      const cached = getCachedWeather(location.lat, location.lon)
      if (cached) { setWeather(cached); return }
    }
    setWeatherLoading(true); setError(null)
    try {
      const data = await fetchForecast(location)
      setCachedWeather(location.lat, location.lon, data)
      setWeather(data)
    } catch {
      setError('Could not load weather data.')
    } finally {
      setWeatherLoading(false)
    }
  }

  async function handlePrefsUpdate(updated: UserPreferences) {
    setPrefs(updated)
    saveLocalPrefs(updated)
    setSyncError(null)
    if (user) {
      try {
        await saveFirestorePrefs(user.uid, updated)
      } catch {
        setSyncError('Saved on this device, but cloud sync failed. Retry when your connection returns.')
      }
    }
  }

  function handleOnboardingComplete(p: UserPreferences) {
    setPrefs(p)
    setScreen('dashboard')
  }

  if (screen === 'loading') {
    if (accountError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '440px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>☁️</div>
            <h1 style={{ margin: '0 0 8px', fontSize: '20px', color: 'var(--text)' }}>Your account could not load</h1>
            <p role="alert" style={{ margin: '0 0 18px', color: 'var(--text-2)', fontSize: '14px', lineHeight: 1.5 }}>{accountError}</p>
            <button className="btn btn-primary" onClick={() => setAuthReloadKey(key => key + 1)}>Try again</button>
          </div>
        </div>
      )
    }
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
  const displayPrefs = { ...prefs, tier: displayTier }
  // Guests only get the dashboard — no calendar tab bar, and never a stale
  // 'calendar' view (e.g. right after signing out). Derived rather than reset in
  // the auth listener because DevPanel's tierOverride flips displayTier without an
  // auth event. EVERY render decision below must key off effectiveView, never `view`.
  const effectiveView = displayTier === 'anonymous' ? 'dashboard' : view

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 40 }}>
        <Header user={user} prefs={prefs} displayTier={displayTier} onPrefsUpdate={p => { handlePrefsUpdate(p); fetchWeather(p.location) }} forceOpenTab={prefsOpen ? prefsTab : undefined} onModalClose={() => setPrefsOpen(false)} onGoHome={() => { setView('dashboard'); setSelectedDay(null) }} currentUV={weather?.current.uv} />
        {displayTier !== 'anonymous' && (
          <div style={{ borderBottom: '0.5px solid var(--border-md)', background: 'var(--bg-card)' }}>
            <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 1rem', display: 'flex', gap: '0' }}>
              {(['dashboard', 'calendar'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '11px 16px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                  background: 'none', border: 'none',
                  borderBottom: effectiveView === v ? '2px solid var(--accent)' : '2px solid transparent',
                  color: effectiveView === v ? 'var(--accent)' : 'var(--text-3)',
                  textTransform: 'capitalize', transition: 'color 0.15s',
                }}>
                  {v === 'dashboard' ? '☀️ Dashboard' : '🗓️ Calendar'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <main style={{ maxWidth: effectiveView === 'calendar' ? '1120px' : '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        <InstallPrompt />
        {foregroundNotice && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '12px', background: '#FFF7ED', border: '0.5px solid #FED7AA', marginBottom: '16px', fontSize: '14px', color: '#9A3412' }}>
            <span>🔔</span><span style={{ flex: 1 }}>Your latest local-morning planning summary is ready.</span>
            <button className="btn" onClick={() => setForegroundNotice(false)} style={{ fontSize: '12px' }}>Dismiss</button>
          </div>
        )}
        {showNotif && <NotificationBanner user={user} onDismiss={() => setShowNotif(false)} />}
        {billingNotice && (
          <div role="status" style={{ padding: '12px 16px', borderRadius: '12px', background: '#EFF6FF', border: '0.5px solid #BFDBFE', marginBottom: '16px', fontSize: '14px', color: '#1E40AF' }}>
            {billingNotice}
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '12px', background: '#FEF2F2', border: '0.5px solid #FECACA', marginBottom: '16px', fontSize: '14px', color: '#991B1B' }}>
            <span>⚠️</span><span style={{ flex: 1 }}>{error}</span>
            <button className="btn" onClick={() => fetchWeather(prefs.location, true)} style={{ fontSize: '12px' }}>Retry</button>
          </div>
        )}
        {syncError && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '12px', background: '#FFF7ED', border: '0.5px solid #FED7AA', marginBottom: '16px', fontSize: '14px', color: '#9A3412' }}>
            <span>☁️</span><span style={{ flex: 1 }}>{syncError}</span>
            <button className="btn" onClick={() => handlePrefsUpdate(prefs)} style={{ fontSize: '12px' }}>Retry sync</button>
          </div>
        )}
        {effectiveView === 'dashboard' && (
          <>
            {weatherLoading && <Skeleton />}
            {weather && !weatherLoading && (
              <ErrorBoundary label="the dashboard" onReset={() => fetchWeather(prefs.location, true)}>
                <Dashboard weather={weather} prefs={prefs} displayTier={displayTier} onPrefsUpdate={handlePrefsUpdate} onRefresh={() => fetchWeather(prefs.location, true)} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
              </ErrorBoundary>
            )}
          </>
        )}
        {effectiveView === 'calendar' && (
          <div className="card">
            <ErrorBoundary label="the calendar" onReset={() => fetchWeather(prefs.location, true)}>
              <CalendarView prefs={prefs} displayTier={displayTier} weather={weather} onPrefsUpdate={handlePrefsUpdate} />
            </ErrorBoundary>
          </div>
        )}
      </main>
      {isDev && (
        <DevPanel
          currentTier={displayTier}
          onOverride={setTierOverride}
        />
      )}
    </div>
  )
}
