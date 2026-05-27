'use client'

import { useState } from 'react'
import { UserPreferences, SkinType, Activity, Location } from '@/lib/types'
import { DEFAULT_ACTIVITIES } from '@/lib/weather'
import { clearWeatherCache } from '@/lib/cache'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
}

const SKIN_OPTIONS: { value: SkinType; label: string }[] = [
  { value: 'very-fair', label: 'Very fair' },
  { value: 'fair',      label: 'Fair' },
  { value: 'medium',    label: 'Medium' },
  { value: 'olive',     label: 'Olive' },
  { value: 'dark',      label: 'Dark' },
]

export default function PreferencesModal({ prefs, onSave, onClose }: Props) {
  const [skinType,   setSkinType]   = useState<SkinType>(prefs.skinType)
  const [sunscreen,  setSunscreen]  = useState(prefs.sunscreen)
  const [activities, setActivities] = useState<Activity[]>(
    prefs.activities.length ? prefs.activities : DEFAULT_ACTIVITIES
  )
  const [cityInput,  setCityInput]  = useState(prefs.location.city)
  const [citySearch, setCitySearch] = useState('')
  const [location,   setLocation]   = useState<Location>(prefs.location)
  const [locLoading, setLocLoading] = useState(false)
  const [locError,   setLocError]   = useState<string | null>(null)
  const [tab,        setTab]        = useState<'general' | 'activities' | 'location'>('general')

  function setDuration(id: string, raw: string) {
    const mins = Math.max(5, parseInt(raw) || 0)
    setActivities(prev => prev.map(a => a.id === id ? { ...a, durationMins: mins } : a))
  }

  function adjustDuration(id: string, delta: number) {
    setActivities(prev => prev.map(a =>
      a.id === id ? { ...a, durationMins: Math.max(5, a.durationMins + delta) } : a
    ))
  }

  async function searchCity() {
    if (!citySearch.trim()) return
    setLocLoading(true)
    setLocError(null)
    try {
      const res  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(citySearch)}&count=1&language=en&format=json`)
      const data = await res.json()
      if (!data.results?.length) throw new Error('Not found')
      const r = data.results[0]
      const newLoc: Location = {
        lat: r.latitude, lon: r.longitude,
        city: r.name, region: r.admin1 ?? r.country ?? '',
      }
      setLocation(newLoc)
      setCityInput(r.name)
      clearWeatherCache()
    } catch {
      setLocError('City not found. Try a different spelling.')
    } finally {
      setLocLoading(false)
    }
  }

  async function useCurrentLocation() {
    setLocLoading(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords
          const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
          const data = await res.json()
          const city = data.address?.city || data.address?.town || data.address?.village || 'Your location'
          const region = data.address?.state || ''
          setLocation({ lat, lon, city, region })
          setCityInput(city)
          clearWeatherCache()
        } catch {
          setLocError('Could not resolve location name.')
        } finally {
          setLocLoading(false)
        }
      },
      () => { setLocError('Location access denied.'); setLocLoading(false) }
    )
  }

  function handleSave() {
    onSave({ ...prefs, skinType, sunscreen, activities, location })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 px-0 sm:px-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Preferences</h2>
          <button className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex border-b border-gray-100 px-5">
          {(['general', 'activities', 'location'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2.5 mr-4 text-xs font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">

          {tab === 'general' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Skin type</p>
                <div className="flex flex-wrap gap-2">
                  {SKIN_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setSkinType(o.value)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
                        skinType === o.value
                          ? 'border-orange-400 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Sunscreen preference</p>
                <div className="flex gap-2">
                  {[false, true].map(val => (
                    <button
                      key={String(val)}
                      onClick={() => setSunscreen(val)}
                      className={`flex-1 py-2 rounded-xl border text-sm transition-all ${
                        sunscreen === val
                          ? 'border-orange-400 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {val ? 'Wear SPF 30+' : 'No sunscreen'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'activities' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-3">Set how long you typically do each activity.</p>
              {activities.map(a => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50">
                  <span className="text-lg w-7 shrink-0">{a.icon}</span>
                  <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{a.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-base leading-none"
                      onClick={() => adjustDuration(a.id, -15)}
                    >−</button>
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={a.durationMins}
                      onChange={e => setDuration(a.id, e.target.value)}
                      className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1 outline-none focus:ring-2 focus:ring-orange-300"
                    />
                    <span className="text-xs text-gray-400 w-5">min</span>
                    <button
                      className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-base leading-none"
                      onClick={() => adjustDuration(a.id, 15)}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'location' && (
            <div className="space-y-4">
              <div className="metric-card text-sm">
                <p className="text-xs text-gray-500 mb-0.5">Current location</p>
                <p className="font-medium text-gray-900">{location.city}{location.region ? `, ${location.region}` : ''}</p>
              </div>
              <button className="btn w-full justify-center text-sm" onClick={useCurrentLocation} disabled={locLoading}>
                📍 {locLoading ? 'Detecting...' : 'Use current location'}
              </button>
              <div className="relative flex items-center gap-2">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">or search</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="e.g. Chicago"
                  value={citySearch}
                  onChange={e => setCitySearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchCity()}
                />
                <button className="btn" onClick={searchCity} disabled={locLoading}>
                  {locLoading ? '...' : 'Search'}
                </button>
              </div>
              {locError && <p className="text-red-500 text-xs">{locError}</p>}
            </div>
          )}

        </div>

        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-2">
          <button className="btn flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center" onClick={handleSave}>Save changes</button>
        </div>
      </div>
    </div>
  )
}
