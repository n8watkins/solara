'use client'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { loadLocalPrefs, loadFirestorePrefs, defaultPrefs, saveLocalPrefs, saveFirestorePrefs } from '@/lib/prefs'
import { getCachedWeather, setCachedWeather } from '@/lib/cache'
import { fetchForecast } from '@/lib/forecast'
import { getFCMTokenLocally } from '@/lib/notifications'
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
  const [showNotif,      setShowNotif]      = useState(false)
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    async function loadPrefs(u: User | null) {
      setUser(u)
      let loaded: UserPreferences | null = null

      if (u) loaded = await loadFirestorePrefs(u.uid)

      if (!loaded) {
        const local = loadLocalPrefs()
        if (local?.location) {
          loaded = {
            ...defaultPrefs(local.location as Location),
            ...local,
            tier: local.tier ?? (u ? 'free' : 'anonymous'),
          }
        }
      }

      if (loaded) {
        setPrefs(loaded)
        setScreen('dashboard')
        if ('Notification' in window && Notification.permission === 'default' && !getFCMTokenLocally()) {
          setTimeout(() => setShowNotif(true), 4000)
        }
      } else {
        // A sign-in popup mid-onboarding re-fires this listener with no stored prefs
        // yet — don't yank a brand-new user back to the welcome screen.
        setScreen(prev => (prev === 'onboarding' ? prev : 'welcome'))
      }
    }

    if (auth) {
      const unsub = onAuthStateChanged(auth, loadPrefs)
      return () => unsub()
    } else {
      loadPrefs(null)
    }
  }, [])

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
    if (user) await saveFirestorePrefs(user.uid, updated)
  }

  function handleOnboardingComplete(p: UserPreferences) {
    setPrefs(p)
    setScreen('dashboard')
  }

  if (screen === 'loading') {
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
    return <Onboarding onComplete={handleOnboardingComplete} user={user} />
  }

  const displayTier = tierOverride || prefs.tier || 'anonymous'
  const displayPrefs = { ...prefs, tier: displayTier }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Header user={user} prefs={prefs} displayTier={displayTier} onPrefsUpdate={p => { handlePrefsUpdate(p); fetchWeather(p.location) }} forceOpenTab={prefsOpen ? prefsTab : undefined} onModalClose={() => setPrefsOpen(false)} onGoHome={() => { setView('dashboard'); setSelectedDay(null) }} currentUV={weather?.current.uv} />
      <div style={{ borderBottom: '0.5px solid var(--border-md)', background: 'var(--bg-card)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 1rem', display: 'flex', gap: '0' }}>
          {(['dashboard', 'calendar'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '12px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: view === v ? '2px solid var(--accent)' : '2px solid transparent',
              color: view === v ? 'var(--accent)' : 'var(--text-3)',
              textTransform: 'capitalize', transition: 'color 0.15s',
            }}>
              {v === 'dashboard' ? '☀️ Dashboard' : '🗓️ Calendar'}
            </button>
          ))}
        </div>
      </div>
      <main style={{ maxWidth: view === 'calendar' ? '1120px' : '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        <InstallPrompt />
        {showNotif && <NotificationBanner user={user} onDismiss={() => setShowNotif(false)} />}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '12px', background: '#FEF2F2', border: '0.5px solid #FECACA', marginBottom: '16px', fontSize: '14px', color: '#991B1B' }}>
            <span>⚠️</span><span style={{ flex: 1 }}>{error}</span>
            <button className="btn" onClick={() => fetchWeather(prefs.location, true)} style={{ fontSize: '12px' }}>Retry</button>
          </div>
        )}
        {view === 'dashboard' && (
          <>
            {weatherLoading && <Skeleton />}
            {weather && !weatherLoading && (
              <ErrorBoundary label="the dashboard" onReset={() => fetchWeather(prefs.location, true)}>
                <Dashboard weather={weather} prefs={prefs} displayTier={displayTier} onPrefsUpdate={handlePrefsUpdate} onRefresh={() => fetchWeather(prefs.location, true)} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
              </ErrorBoundary>
            )}
          </>
        )}
        {view === 'calendar' && (
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
