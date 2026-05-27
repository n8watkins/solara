'use client'
import { useState } from 'react'
import { User, signInWithPopup, signOut } from 'firebase/auth'
import { UserPreferences, SkinType, Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import { TIER_LABELS, TIER_LIMITS } from '@/lib/tiers'
import { toggleTheme, getStoredTheme } from '@/lib/theme'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'
import ActivityManager from './ActivityManager'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
  initialTab?: Tab
  user?: User | null
}

const SKIN_OPTIONS: { value: SkinType; label: string; burn: string }[] = [
  { value: 'very-fair', label: 'Very fair',  burn: '~10m at UV 10' },
  { value: 'fair',      label: 'Fair',       burn: '~15m at UV 10' },
  { value: 'medium',    label: 'Medium',     burn: '~25m at UV 10' },
  { value: 'olive',     label: 'Olive',      burn: '~35m at UV 10' },
  { value: 'dark',      label: 'Dark',       burn: '~50m at UV 10' },
]

type Tab = 'general' | 'activities' | 'location' | 'account'

export default function PreferencesModal({ prefs, onSave, onClose, initialTab, user }: Props) {
  const [tab,        setTab]        = useState<Tab>(initialTab || 'general')
  const [skinType,   setSkinType]   = useState<SkinType>(prefs.skinType)
  const [sunscreen,  setSunscreen]  = useState(prefs.sunscreen)
  const [activities, setActivities] = useState(prefs.activities)
  const [location,   setLocation]   = useState<Location>(prefs.location)
  const [citySearch, setCitySearch] = useState('')
  const [locLoading, setLocLoading] = useState(false)
  const [locError,   setLocError]   = useState<string | null>(null)
  const [dark,       setDark]       = useState(getStoredTheme() === 'dark')
  const tier = prefs.tier || 'anonymous'

  function handleToggleTheme() {
    const next = toggleTheme()
    setDark(next === 'dark')
  }

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
      } catch { setLocError('Could not resolve.') }
      finally   { setLocLoading(false) }
    }, () => { setLocError('Location denied.'); setLocLoading(false) })
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'general',    label: 'General'    },
    { id: 'activities', label: 'Activities' },
    { id: 'location',   label: 'Location'   },
    { id: 'account',    label: 'Account'    },
  ]

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '16px' }}
    >
      <div style={{ background: 'var(--bg-card)', borderRadius: '18px', width: '100%', maxWidth: '480px', maxHeight: 'min(88vh, 640px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '0.5px solid var(--border-md)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 14px', borderBottom: '0.5px solid var(--border-md)', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>Preferences</p>
          <button onClick={onClose} style={{ background: 'var(--bg-metric)', border: 'none', width: '28px', height: '28px', borderRadius: '50%', fontSize: '16px', cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-md)', padding: '0 20px', flexShrink: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '11px 0', marginRight: '18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-3)', transition: 'color 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>

          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div>
                <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Skin type</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {SKIN_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => setSkinType(o.value)} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                      border: skinType === o.value ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                      background: skinType === o.value ? 'rgba(249,115,22,0.07)' : 'transparent',
                      color: 'var(--text)', transition: 'all 0.12s',
                    }}>
                      <span style={{ fontSize: '14px', fontWeight: skinType === o.value ? 500 : 400 }}>{o.label}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{o.burn}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Sunscreen preference</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { val: false, label: 'No sunscreen',  sub: 'Show naturally safe windows' },
                    { val: true,  label: 'Wear SPF 30+',  sub: 'Extended safe windows' },
                  ].map(o => (
                    <button key={String(o.val)} onClick={() => setSunscreen(o.val)} style={{
                      flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                      border: sunscreen === o.val ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                      background: sunscreen === o.val ? 'rgba(249,115,22,0.07)' : 'transparent', transition: 'all 0.12s',
                    }}>
                      <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{o.label}</p>
                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-3)' }}>{o.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Appearance</p>
                <button
                  onClick={handleToggleTheme}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                    border: '0.5px solid var(--border-md)', background: 'transparent', color: 'var(--text)',
                    transition: 'background 0.12s',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{dark ? '🌙 Dark mode' : '☀️ Light mode'}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Click to toggle</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'activities' && (
            <ActivityManager selected={activities} tier={tier} onChange={setActivities} />
          )}

          {tab === 'location' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="metric-card">
                <p style={{ margin: '0 0 3px', fontSize: '11px', color: 'var(--text-3)' }}>Current location</p>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 500, color: 'var(--text)' }}>
                  {location.city}{location.region ? `, ${location.region}` : ''}
                </p>
              </div>
              <button className="btn" onClick={useCurrentLocation} disabled={locLoading} style={{ justifyContent: 'center' }}>
                📍 {locLoading ? 'Detecting…' : 'Use current location'}
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input placeholder="Search a city…" value={citySearch} onChange={e => setCitySearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchCity()} style={{ flex: 1 }} />
                <button className="btn" onClick={searchCity} disabled={locLoading}>{locLoading ? '…' : 'Search'}</button>
              </div>
              {locError && <p style={{ margin: 0, fontSize: '12px', color: '#DC2626' }}>{locError}</p>}
            </div>
          )}

          {tab === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 3px', fontSize: '11px', color: 'var(--text-3)' }}>Current plan</p>
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: tier === 'paid' ? 'var(--accent)' : 'var(--text)' }}>
                    {TIER_LABELS[tier]}
                  </p>
                </div>
                {tier !== 'paid' && (
                  <button className="btn btn-primary" style={{ fontSize: '12px' }}>Upgrade to Pro</button>
                )}
              </div>

              <div style={{ background: 'var(--bg-metric)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '12px', fontWeight: 500, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plan limits</p>
                {[
                  ['Activities', tier === 'paid' ? 'Unlimited' : `${activities.length} / ${TIER_LIMITS[tier].activities}`],
                  ['Calendar sync', TIER_LIMITS[tier].calendar ? '✓' : '—'],
                  ['Push notifications', TIER_LIMITS[tier].notifications ? '✓' : '—'],
                  ['10-day forecast', tier === 'paid' ? '✓' : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-2)' }}>{label}</span>
                    <span style={{ color: val === '—' ? 'var(--text-3)' : 'var(--text)', fontWeight: 500 }}>{val}</span>
                  </div>
                ))}
              </div>

              {user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="metric-card">
                    <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--text-3)' }}>Signed in as</p>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>{user.displayName || user.email}</p>
                  </div>
                  <button
                    className="btn"
                    onClick={async () => { if (auth) await signOut(auth); onClose() }}
                    style={{ justifyContent: 'center', color: '#DC2626', borderColor: '#FECACA' }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>
                    Sign in to sync preferences across devices.
                  </p>
                  {firebaseEnabled ? (
                    <button
                      className="btn btn-primary"
                      onClick={async () => { if (auth && googleProvider) { try { await signInWithPopup(auth, googleProvider) } catch {} } }}
                      style={{ justifyContent: 'center' }}
                    >
                      Sign in with Google
                    </button>
                  ) : (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', fontStyle: 'italic' }}>
                      Firebase not configured — running in local mode.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '0.5px solid var(--border-md)', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...prefs, skinType, sunscreen, activities, location })} style={{ flex: 1, justifyContent: 'center' }}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
