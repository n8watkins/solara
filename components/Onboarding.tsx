'use client'

import { useState } from 'react'
import { User } from 'firebase/auth'
import { saveLocalPrefs, saveFirestorePrefs, defaultPrefs } from '@/lib/prefs'
import { UserPreferences, Location, SkinType } from '@/lib/types'

interface Props {
  onComplete: (prefs: UserPreferences) => void
  user: User | null
}

const SKIN_OPTIONS: { value: SkinType; label: string; desc: string }[] = [
  { value: 'very-fair', label: 'Very fair',  desc: 'Burns easily, rarely tans' },
  { value: 'fair',      label: 'Fair',       desc: 'Burns often, tans lightly' },
  { value: 'medium',    label: 'Medium',     desc: 'Burns sometimes, tans gradually' },
  { value: 'olive',     label: 'Olive',      desc: 'Rarely burns, tans easily' },
  { value: 'dark',      label: 'Dark',       desc: 'Very rarely burns' },
]

export default function Onboarding({ onComplete, user }: Props) {
  const [step, setStep] = useState<'location' | 'skin' | 'sunscreen'>('location')
  const [locLoading, setLocLoading] = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [skinType, setSkinType] = useState<SkinType>('fair')
  const [sunscreen, setSunscreen] = useState(false)

  async function handleGeolocate() {
    setLocLoading(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        const city = await reverseGeocode(lat, lon)
        setLocation({ lat, lon, ...city })
        setLocLoading(false)
        setStep('skin')
      },
      () => {
        setGeoError('Location access denied. Enter your city below.')
        setLocLoading(false)
      }
    )
  }

  async function handleCitySearch() {
    if (!cityInput.trim()) return
    setLocLoading(true)
    setGeoError(null)
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput)}&count=1&language=en&format=json`
      )
      const data = await res.json()
      if (!data.results?.length) throw new Error('City not found')
      const r = data.results[0]
      setLocation({
        lat: r.latitude,
        lon: r.longitude,
        city: r.name,
        region: r.admin1 ?? r.country ?? '',
      })
      setStep('skin')
    } catch {
      setGeoError('City not found. Try a different spelling.')
    } finally {
      setLocLoading(false)
    }
  }

  async function handleFinish() {
    if (!location) return
    const prefs: UserPreferences = {
      ...defaultPrefs(location),
      skinType,
      sunscreen,
    }
    saveLocalPrefs(prefs)
    if (user) await saveFirestorePrefs(user.uid, { ...prefs, uid: user.uid })
    onComplete(prefs)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">☀️</div>
          <h1 className="text-2xl font-semibold text-gray-900">Solara</h1>
          <p className="text-gray-500 text-sm mt-1">Know your sun window</p>
        </div>

        {step === 'location' && (
          <div className="card">
            <h2 className="font-medium text-gray-900 mb-1">Where are you?</h2>
            <p className="text-sm text-gray-500 mb-5">
              Solara uses your location to pull live UV and weather data.
            </p>
            <button
              className="btn btn-primary w-full justify-center mb-3"
              onClick={handleGeolocate}
              disabled={locLoading}
            >
              {locLoading ? 'Getting location...' : '📍 Use my current location'}
            </button>
            <div className="relative flex items-center gap-2 my-3">
              <div className="flex-1 border-t border-gray-200" />
              <span className="text-xs text-gray-400">or type a city</span>
              <div className="flex-1 border-t border-gray-200" />
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. Los Angeles"
                value={cityInput}
                onChange={e => setCityInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCitySearch()}
              />
              <button className="btn" onClick={handleCitySearch} disabled={locLoading}>
                Go
              </button>
            </div>
            {geoError && <p className="text-red-500 text-xs mt-2">{geoError}</p>}
          </div>
        )}

        {step === 'skin' && (
          <div className="card">
            <h2 className="font-medium text-gray-900 mb-1">What's your skin type?</h2>
            <p className="text-sm text-gray-500 mb-4">
              This determines your safe UV thresholds and burn times.
            </p>
            <div className="flex flex-col gap-2 mb-5">
              {SKIN_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setSkinType(o.value)}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                    skinType === o.value
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-900">{o.label}</span>
                  <span className="text-xs text-gray-500">{o.desc}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary w-full justify-center" onClick={() => setStep('sunscreen')}>
              Next →
            </button>
          </div>
        )}

        {step === 'sunscreen' && (
          <div className="card">
            <h2 className="font-medium text-gray-900 mb-1">Do you wear sunscreen?</h2>
            <p className="text-sm text-gray-500 mb-5">
              This changes the safe UV windows for each activity.
            </p>
            <div className="flex flex-col gap-3 mb-5">
              <button
                onClick={() => setSunscreen(false)}
                className={`px-4 py-4 rounded-xl border text-left transition-all ${
                  !sunscreen ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">No sunscreen</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  I want to know exactly when the UV is low enough to go out safely on its own.
                </p>
              </button>
              <button
                onClick={() => setSunscreen(true)}
                className={`px-4 py-4 rounded-xl border text-left transition-all ${
                  sunscreen ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">I wear SPF 30+</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  I'm willing to wear sunscreen — show me extended safe windows.
                </p>
              </button>
            </div>
            <button className="btn btn-primary w-full justify-center" onClick={handleFinish}>
              Open my dashboard →
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          Your preferences are saved locally. Sign in to sync across devices.
        </p>
      </div>
    </div>
  )
}

async function reverseGeocode(lat: number, lon: number): Promise<{ city: string; region: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
    )
    const data = await res.json()
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.county ||
      'Your location'
    const region = data.address?.state || data.address?.country || ''
    return { city, region }
  } catch {
    return { city: 'Your location', region: '' }
  }
}
