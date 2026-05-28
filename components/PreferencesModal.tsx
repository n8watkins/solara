'use client'
import { useState } from 'react'
import { User, signInWithPopup, signOut } from 'firebase/auth'
import { UserPreferences, SkinType, Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import { TIER_LABELS, TIER_LIMITS } from '@/lib/tiers'
import { toggleTheme, getStoredTheme } from '@/lib/theme'
import { auth, googleProvider, firebaseEnabled } from '@/lib/firebase'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
  initialTab?: LegacyTab
  user?: User | null
}

const SKIN_OPTIONS: { value: SkinType; label: string; burn: string; desc: string }[] = [
  { value: 'very-fair', label: 'Very fair',  burn: '~10m at UV 10', desc: 'Burns easily, rarely tans' },
  { value: 'fair',      label: 'Fair',       burn: '~15m at UV 10', desc: 'Burns often, tans lightly' },
  { value: 'medium',    label: 'Medium',     burn: '~25m at UV 10', desc: 'Burns sometimes, tans well' },
  { value: 'olive',     label: 'Olive',      burn: '~35m at UV 10', desc: 'Rarely burns, tans easily' },
  { value: 'dark',      label: 'Dark',       burn: '~50m at UV 10', desc: 'Very rarely burns' },
]

type LegacyTab = 'general' | 'activities' | 'location'
type Tab = 'general' | 'appearance' | 'activities' | 'location' | 'account'

export default function PreferencesModal({ prefs, onSave, onClose, initialTab, user }: Props) {
  const [tab,        setTab]        = useState<Tab>(initialTab || 'general')
  const [skinType,   setSkinType]   = useState<SkinType>(prefs.skinType)
  const [sunscreen,  setSunscreen]  = useState(prefs.sunscreen)
  const [location,   setLocation]   = useState<Location>(prefs.location)
  const [citySearch, setCitySearch] = useState('')
  const [locLoading, setLocLoading] = useState(false)
  const [locError,   setLocError]   = useState<string | null>(null)
  const [dark,       setDark]       = useState(getStoredTheme() === 'dark')
  const [upgradeEmail, setUpgradeEmail] = useState(user?.email ?? prefs.upgradeInterest?.email ?? '')
  const [upgradeSaved, setUpgradeSaved] = useState(false)
  const [showSkinHelp, setShowSkinHelp] = useState(false)
  const tier = prefs.tier || 'anonymous'

  const selectedSkin = SKIN_OPTIONS.find(o => o.value === skinType) ?? SKIN_OPTIONS[1]
  const draft: UserPreferences = { ...prefs, skinType, sunscreen, location }
  const dirty = JSON.stringify({ skinType: prefs.skinType, sunscreen: prefs.sunscreen, location: prefs.location }) !==
    JSON.stringify({ skinType, sunscreen, location })

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved settings changes?')) return
    onClose()
  }

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

  function saveUpgradeInterest() {
    const updated: UserPreferences = {
      ...draft,
      upgradeInterest: {
        email: upgradeEmail.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
    }
    onSave(updated)
    setUpgradeSaved(true)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'general',    label: 'Sun profile' },
    { id: 'appearance', label: 'Appearance'  },
    { id: 'activities', label: 'Activity prefs' },
    { id: 'location',   label: 'Location'    },
    { id: 'account',    label: 'Account'     },
  ]

  return (
    <div
      onClick={e => e.target === e.currentTarget && requestClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '16px' }}
    >
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', width: '100%', maxWidth: '620px', height: 'min(86vh, 680px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '0.5px solid var(--border-md)', boxShadow: '0 24px 80px rgba(0,0,0,0.24)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 22px 16px', borderBottom: '0.5px solid var(--border-md)', flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>Settings</p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>Profile, app, location, and account controls.</p>
          </div>
          <button onClick={requestClose} style={{ background: 'var(--bg-metric)', border: 'none', width: '32px', height: '32px', borderRadius: '50%', fontSize: '18px', cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close settings">×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-md)', padding: '0 22px', flexShrink: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '13px 0', marginRight: '20px', fontSize: '13px', fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-3)', transition: 'color 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 22px' }}>

          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
                  <div>
                    <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Skin type</p>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                      Used for burn-time and vitamin D estimates.
                    </p>
                  </div>
                  <select
                    value={skinType}
                    onChange={e => setSkinType(e.target.value as SkinType)}
                    style={{ minWidth: '170px', fontSize: '14px' }}
                  >
                    {SKIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', background: 'var(--bg-card)', border: '0.5px solid var(--border-md)' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>{selectedSkin.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>{selectedSkin.desc}</p>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{selectedSkin.burn}</span>
                </div>
                <button className="btn btn-ghost" onClick={() => setShowSkinHelp(s => !s)} style={{ justifyContent: 'flex-start', padding: '4px 0', fontSize: '12px', color: 'var(--accent)' }}>
                  {showSkinHelp ? 'Hide explanation' : 'How skin type affects Solara'}
                </button>
                {showSkinHelp && (
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, color: 'var(--text-2)' }}>
                    Lighter skin typically burns faster at the same UV level. Solara uses this profile to estimate burn limits and useful sun exposure windows. These are planning estimates, not medical advice.
                  </p>
                )}
              </div>

              <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Legacy sunscreen default</p>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                    This only supports older saved data. Active sunscreen choices now belong with activities on the Dashboard.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { val: false, label: 'No sunscreen' },
                    { val: true,  label: 'SPF 30+' },
                  ].map(o => (
                    <button key={String(o.val)} onClick={() => setSunscreen(o.val)} style={{
                      flex: 1, padding: '11px 12px', borderRadius: '10px', cursor: 'pointer', textAlign: 'center',
                      border: sunscreen === o.val ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                      background: sunscreen === o.val ? 'rgba(249,115,22,0.07)' : 'var(--bg-card)', transition: 'all 0.12s',
                      color: 'var(--text)', fontSize: '13px', fontWeight: 650,
                    }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="metric-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Theme</p>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>Switch between light and dark mode.</p>
                </div>
                <button
                  onClick={handleToggleTheme}
                  className="btn"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {dark ? '🌙 Dark' : '☀️ Light'}
                </button>
              </div>
            </div>
          )}

          {tab === 'activities' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Activity preferences</p>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Add, remove, and customize activities from the main Dashboard Activity section. Settings will only manage activity suggestion preferences here later.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                <div className="metric-card">
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Current activities</p>
                  <p style={{ margin: 0, fontSize: '20px', fontWeight: 750, color: 'var(--text)' }}>{prefs.activities.length}</p>
                </div>
                <div className="metric-card">
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-3)' }}>Plan limit</p>
                  <p style={{ margin: 0, fontSize: '20px', fontWeight: 750, color: 'var(--text)' }}>{tier === 'paid' ? 'Unlimited' : TIER_LIMITS[tier].activities}</p>
                </div>
              </div>
            </div>
          )}

          {tab === 'location' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="metric-card">
                <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)' }}>Current location</p>
                <p style={{ margin: 0, fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>
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
              <div className="metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <p style={{ margin: '0 0 3px', fontSize: '12px', color: 'var(--text-3)' }}>Current plan</p>
                  <p style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: tier === 'paid' ? 'var(--accent)' : 'var(--text)' }}>
                    {TIER_LABELS[tier]}
                  </p>
                </div>
                {tier !== 'paid' && (
                  <button className="btn btn-primary" onClick={saveUpgradeInterest} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {upgradeSaved || prefs.upgradeInterest ? '✓ On waitlist' : 'Join Pro waitlist'}
                  </button>
                )}
              </div>

              {tier !== 'paid' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-metric)', borderRadius: '10px', padding: '12px 14px' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Pro is coming soon</p>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                    Pro will focus on unlimited activities, smarter weekly planning, and daily sun-window notifications.
                  </p>
                  <input
                    placeholder="Email for early access"
                    value={upgradeEmail}
                    onChange={e => setUpgradeEmail(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                  {upgradeSaved && <p style={{ margin: 0, fontSize: '12px', color: 'var(--accent)' }}>You’re on the list. Tiny growth loop, big dreams.</p>}
                </div>
              )}

              <div style={{ background: 'var(--bg-metric)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ margin: 0, fontSize: '12px', fontWeight: 650, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plan limits</p>
                {[
                  ['Activities', tier === 'paid' ? 'Unlimited' : `${prefs.activities.length} / ${TIER_LIMITS[tier].activities}`],
                  ['Calendar sync', TIER_LIMITS[tier].calendar ? '✓' : '—'],
                  ['Push notifications', TIER_LIMITS[tier].notifications ? '✓' : '—'],
                  ['10-day forecast', tier === 'paid' ? '✓' : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-2)' }}>{label}</span>
                    <span style={{ color: val === '—' ? 'var(--text-3)' : 'var(--text)', fontWeight: 600 }}>{val}</span>
                  </div>
                ))}
              </div>

              {user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="metric-card">
                    <p style={{ margin: '0 0 2px', fontSize: '12px', color: 'var(--text-3)' }}>Signed in as</p>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{user.displayName || user.email}</p>
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

        <div style={{ padding: '15px 22px', borderTop: '0.5px solid var(--border-md)', display: 'flex', gap: '10px', flexShrink: 0 }}>
          <button className="btn" onClick={requestClose} style={{ flex: 1, justifyContent: 'center' }}>{dirty ? 'Discard' : 'Cancel'}</button>
          <button className="btn btn-primary" onClick={() => onSave(draft)} style={{ flex: 1, justifyContent: 'center' }}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
