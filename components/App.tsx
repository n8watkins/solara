'use client'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { loadLocalPrefs, loadFirestorePrefs, defaultPrefs } from '@/lib/prefs'
import { getCachedWeather, setCachedWeather } from '@/lib/cache'
import { getFCMTokenLocally } from '@/lib/notifications'
import { UserPreferences, WeatherResponse, Location, TierLevel } from '@/lib/types'
import Welcome from './Welcome'
import Onboarding from './Onboarding'
import Dashboard from './Dashboard'
import Header from './Header'
import Skeleton from './Skeleton'
import NotificationBanner from './NotificationBanner'
import CalendarView from './CalendarView'
import DevPanel, { getDevTierOverride } from './DevPanel'

function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3)  return 'Partly cloudy'
  if (code <= 49) return 'Foggy'
  if (code <= 67) return 'Rainy'
  if (code <= 77) return 'Snowy'
  if (code <= 82) return 'Showers'
  return 'Stormy'
}

type Screen = 'loading' | 'welcome' | 'onboarding' | 'dashboard'

export default function App() {
  const [user,           setUser]           = useState<User | null>(null)
  const [prefs,          setPrefs]          = useState<UserPreferences | null>(null)
  const [weather,        setWeather]        = useState<WeatherResponse | null>(null)
  const [screen,         setScreen]         = useState<Screen>('loading')
  const [view,           setView]           = useState<'dashboard' | 'calendar'>('dashboard')
  const [tierOverride,   setTierOverride]   = useState<TierLevel | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [showNotif,      setShowNotif]      = useState(false)

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
            skinType:           (local.skinType  as UserPreferences['skinType'])  ?? 'fair',
            activities:         (local.activities as UserPreferences['activities']) ?? [],
            sunscreen:          (local.sunscreen  as boolean)                      ?? false,
            tier:               (local.tier       as UserPreferences['tier'])      ?? (u ? 'free' : 'anonymous'),
            onboardingComplete: (local.onboardingComplete as boolean)              ?? false,
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
        setScreen('welcome')
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
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${location.lat}&longitude=${location.lon}` +
        `&hourly=uv_index,temperature_2m,weathercode` +
        `&current=uv_index,temperature_2m,weathercode` +
        `&timezone=auto&forecast_days=2`
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const raw = await res.json()
      const todayStr    = new Date().toISOString().split('T')[0]
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      const parse = (d: string) => raw.hourly.time
        .map((t: string, i: number) => ({
          date: t.split('T')[0], hour: parseInt(t.split('T')[1].split(':')[0]),
          uv: Math.round(raw.hourly.uv_index[i] * 10) / 10,
          tempF: Math.round(raw.hourly.temperature_2m[i] * 9 / 5 + 32),
          condition: weatherLabel(raw.hourly.weathercode[i]),
        }))
        .filter((h: any) => h.date === d && h.hour >= 6 && h.hour <= 20)
      const data: WeatherResponse = {
        current: {
          uv: Math.round(raw.current.uv_index * 10) / 10,
          tempF: Math.round(raw.current.temperature_2m * 9 / 5 + 32),
          condition: weatherLabel(raw.current.weathercode),
        },
        today: parse(todayStr), tomorrow: parse(tomorrowStr),
      }
      setCachedWeather(location.lat, location.lon, data)
      setWeather(data)
    } catch {
      setError('Could not load weather data.')
    } finally {
      setWeatherLoading(false)
    }
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Header user={user} prefs={tierOverride ? { ...prefs, tier: tierOverride } : prefs} onPrefsUpdate={setPrefs} />
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
      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
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
              <Dashboard weather={weather} prefs={tierOverride ? { ...prefs, tier: tierOverride } : prefs} onRefresh={() => fetchWeather(prefs.location, true)} />
            )}
          </>
        )}
        {view === 'calendar' && (
          <div className="card">
            <CalendarView prefs={tierOverride ? { ...prefs, tier: tierOverride } : prefs} />
          </div>
        )}
      </main>
      <DevPanel
        currentTier={tierOverride || prefs.tier || 'anonymous'}
        onOverride={setTierOverride}
      />
    </div>
  )
}
