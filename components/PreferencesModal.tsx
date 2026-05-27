'use client'
import { useState } from 'react'
import { UserPreferences, SkinType, Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import ActivityManager from './ActivityManager'

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

type Tab = 'general' | 'activities' | 'location'

export default function PreferencesModal({ prefs, onSave, onClose }: Props) {
  const [tab,        setTab]        = useState<Tab>('general')
  const [skinType,   setSkinType]   = useState<SkinType>(prefs.skinType)
  const [sunscreen,  setSunscreen]  = useState(prefs.sunscreen)
  const [activities, setActivities] = useState(prefs.activities)
  const [location,   setLocation]   = useState<Location>(prefs.location)
  const [citySearch, setCitySearch] = useState('')
  const [locLoading, setLocLoading] = useState(false)
  const [locError,   setLocError]   = useState<string | null>(null)
  const tier = prefs.tier || 'anonymous'

  async function searchCity() {
    if (!citySearch.trim()) return
    setLocLoading(true); setLocError(null)
    try {
      const res  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(citySearch)}&count=1&language=en&format=json`)
      const data = await res.json()
      if (!data.results?.length) throw new Error()
      const r = data.results[0]
      setLocation({ lat: r.latitude, lon: r.longitude, city: r.name, region: r.admin1 ?? r.country ?? '' })
      clearWeatherCache()
    } catch {
      setLocError('City not found.')
    } finally { setLocLoading(false) }
  }

  async function useCurrentLocation() {
    setLocLoading(true); setLocError(null)
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords
        const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
        const data = await res.json()
        const city = data.address?.city || data.address?.town || data.address?.village || 'Your location'
        setLocation({ lat, lon, city, region: data.address?.state || '' })
        clearWeatherCache()
      } catch { setLocError('Could not resolve location.') }
      finally { setLocLoading(false) }
    }, () => { setLocError('Location denied.'); setLocLoading(false) })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50, padding: '0 0 0' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', borderBottom: '0.5px solid var(--border-md)' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>Preferences</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-3)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-md)', padding: '0 20px' }}>
          {(['general', 'activities', 'location'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 0', marginRight: '20px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-3)',
              textTransform: 'capitalize', transition: 'color 0.15s',
            }}>{t}</button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Skin type</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {SKIN_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => setSkinType(o.value)} style={{
                      padding: '6px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
                      border: skinType === o.value ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                      background: skinType === o.value ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                      color: skinType === o.value ? 'var(--accent)' : 'var(--text)',
                    }}>{o.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Sunscreen</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[false, true].map(v => (
                    <button key={String(v)} onClick={() => setSunscreen(v)} style={{
                      flex: 1, padding: '8px', borderRadius: '10px', fontSize: '13px', cursor: 'pointer',
                      border: sunscreen === v ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                      background: sunscreen === v ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                      color: 'var(--text)',
                    }}>{v ? 'Wear SPF 30+' : 'No sunscreen'}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'activities' && (
            <ActivityManager selected={activities} tier={tier} onChange={setActivities} />
          )}

          {tab === 'location' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="metric-card">
                <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--text-3)' }}>Current location</p>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 500, color: 'var(--text)' }}>{location.city}{location.region ? `, ${location.region}` : ''}</p>
              </div>
              <button className="btn" onClick={useCurrentLocation} disabled={locLoading} style={{ justifyContent: 'center' }}>
                📍 {locLoading ? 'Detecting...' : 'Use current location'}
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input placeholder="Search city..." value={citySearch} onChange={e => setCitySearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchCity()} style={{ flex: 1 }} />
                <button className="btn" onClick={searchCity} disabled={locLoading}>{locLoading ? '...' : 'Search'}</button>
              </div>
              {locError && <p style={{ margin: 0, fontSize: '12px', color: '#DC2626' }}>{locError}</p>}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border-md)', display: 'flex', gap: '8px' }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...prefs, skinType, sunscreen, activities, location })} style={{ flex: 1, justifyContent: 'center' }}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
