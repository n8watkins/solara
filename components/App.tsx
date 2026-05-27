'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { loadLocalPrefs, loadFirestorePrefs, defaultPrefs } from '@/lib/prefs'
import { getCachedWeather, setCachedWeather } from '@/lib/cache'
import { getFCMTokenLocally } from '@/lib/notifications'
import { UserPreferences, WeatherResponse, Location } from '@/lib/types'
import Onboarding from '@/components/Onboarding'
import Dashboard from '@/components/Dashboard'
import Header from '@/components/Header'
import Skeleton from '@/components/Skeleton'
import NotificationBanner from '@/components/NotificationBanner'

function weatherLabel(code: number): string {
  if (code === 0)  return 'Clear'
  if (code <= 3)   return 'Partly cloudy'
  if (code <= 49)  return 'Foggy'
  if (code <= 67)  return 'Rainy'
  if (code <= 77)  return 'Snowy'
  if (code <= 82)  return 'Showers'
  return 'Stormy'
}

export default function App() {
  const [user,           setUser]           = useState<User | null>(null)
  const [prefs,          setPrefs]          = useState<UserPreferences | null>(null)
  const [weather,        setWeather]        = useState<WeatherResponse | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [showNotifBanner, setShowNotifBanner] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      let loaded: UserPreferences | null = null

      if (u) loaded = await loadFirestorePrefs(u.uid)

      if (!loaded) {
        const local = loadLocalPrefs()
        if (local?.location) {
          loaded = defaultPrefs(local.location as Location)
          if (local.skinType)   loaded.skinType   = local.skinType as UserPreferences['skinType']
          if (local.activities) loaded.activities = local.activities as UserPreferences['activities']
          if (local.sunscreen !== undefined) loaded.sunscreen = local.sunscreen as boolean
        }
      }

      setPrefs(loaded)
      setLoading(false)

      if (loaded && 'Notification' in window && Notification.permission === 'default' && !getFCMTokenLocally()) {
        setTimeout(() => setShowNotifBanner(true), 3000)
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!prefs?.location) return
    fetchWeather(prefs.location)
  }, [prefs?.location?.lat, prefs?.location?.lon])

  async function fetchWeather(location: Location, force = false) {
    if (!force) {
      const cached = getCachedWeather(location.lat, location.lon)
      if (cached) { setWeather(cached); return }
    }

    setWeatherLoading(true)
    setError(null)
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${location.lat}&longitude=${location.lon}` +
        `&hourly=uv_index,temperature_2m,weathercode` +
        `&current=uv_index,temperature_2m,weathercode` +
        `&timezone=auto&forecast_days=2`

      const res = await fetch(url)
      if (!res.ok) throw new Error('Weather fetch failed')
      const raw = await res.json()

      const times: string[] = raw.hourly.time
      const uvs: number[]   = raw.hourly.uv_index
      const temps: number[] = raw.hourly.temperature_2m
      const codes: number[] = raw.hourly.weathercode

      const todayStr    = new Date().toISOString().split('T')[0]
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]

      const parse = (dateStr: string) =>
        times
          .map((t, i) => ({
            date:      t.split('T')[0],
            hour:      parseInt(t.split('T')[1].split(':')[0]),
            uv:        Math.round(uvs[i] * 10) / 10,
            tempF:     Math.round(temps[i] * 9 / 5 + 32),
            condition: weatherLabel(codes[i]),
          }))
          .filter(h => h.date === dateStr && h.hour >= 6 && h.hour <= 20)

      const data: WeatherResponse = {
        current: {
          uv:        Math.round(raw.current.uv_index * 10) / 10,
          tempF:     Math.round(raw.current.temperature_2m * 9 / 5 + 32),
          condition: weatherLabel(raw.current.weathercode),
        },
        today:    parse(todayStr),
        tomorrow: parse(tomorrowStr),
      }

      setCachedWeather(location.lat, location.lon, data)
      setWeather(data)
    } catch {
      setError('Could not load weather data. Check your connection.')
    } finally {
      setWeatherLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">☀️</div>
          <p className="text-gray-500 text-sm">Loading Solara...</p>
        </div>
      </div>
    )
  }

  if (!prefs?.location) {
    return <Onboarding onComplete={setPrefs} user={user} />
  }

  return (
    <div className="min-h-screen">
      <Header user={user} prefs={prefs} onPrefsUpdate={setPrefs} />
      <main className="max-w-4xl mx-auto px-4 py-6">
        {showNotifBanner && (
          <NotificationBanner user={user} onDismiss={() => setShowNotifBanner(false)} />
        )}
        {error && (
          <div className="card border-red-200 bg-red-50 text-red-700 text-sm flex items-center gap-3 mb-4">
            <span>⚠️</span>
            <span>{error}</span>
            <button className="ml-auto btn text-xs" onClick={() => fetchWeather(prefs.location, true)}>
              Retry
            </button>
          </div>
        )}
        {weatherLoading && <Skeleton />}
        {weather && !weatherLoading && (
          <Dashboard
            weather={weather}
            prefs={prefs}
            onRefresh={() => fetchWeather(prefs.location, true)}
          />
        )}
      </main>
    </div>
  )
}
