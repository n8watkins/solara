'use client'
import { useState } from 'react'
import { User } from 'firebase/auth'
import { saveLocalPrefs, saveFirestorePrefs, defaultPrefs } from '@/lib/prefs'
import { UserPreferences, Location, SkinType, Activity } from '@/lib/types'
import { TIER_LIMITS, PRESET_ACTIVITIES } from '@/lib/tiers'
import GoogleSignInButton, { ACTIVITY_SIGNIN_BLURB } from './GoogleSignInButton'

interface Props {
  onComplete: (prefs: UserPreferences) => void
  user: User | null
}

type Step = 'location' | 'uvpreview' | 'skin' | 'activities'

// A short, friendly starter set — the full catalog (and custom everything) lives in
// the dashboard once they're in. Onboarding should feel like picking, not shopping.
const STARTER_IDS = ['run', 'walk', 'cycle', 'swim', 'hike', 'dog', 'garden', 'lunch']
const STARTER_ACTIVITIES = STARTER_IDS
  .map(id => PRESET_ACTIVITIES.find(p => p.id === id))
  .filter((p): p is typeof PRESET_ACTIVITIES[number] => !!p)

const SKIN_OPTIONS: { value: SkinType; label: string; desc: string; burnTime: string }[] = [
  { value: 'very-fair', label: 'Very fair',  desc: 'Burns easily, rarely tans', burnTime: '~10 min at UV 10' },
  { value: 'fair',      label: 'Fair',       desc: 'Burns often, tans lightly',  burnTime: '~15 min at UV 10' },
  { value: 'medium',    label: 'Medium',     desc: 'Burns sometimes, tans well', burnTime: '~25 min at UV 10' },
  { value: 'olive',     label: 'Olive',      desc: 'Rarely burns, tans easily',  burnTime: '~35 min at UV 10' },
  { value: 'dark',      label: 'Dark',       desc: 'Very rarely burns',          burnTime: '~50 min at UV 10' },
]

export default function Onboarding({ onComplete, user }: Props) {
  const [step, setStep]           = useState<Step>('location')
  const [locLoading, setLocLoad]  = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError]   = useState<string | null>(null)
  const [location, setLocation]   = useState<Location | null>(null)
  const [uvNow, setUvNow]         = useState<number | null>(null)
  const [uvCity, setUvCity]       = useState('')
  const [skinType, setSkinType]   = useState<SkinType>('fair')
  const [activities, setActivities] = useState<Activity[]>([])
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customMins, setCustomMins] = useState(30)
  const tier = user ? 'free' : 'anonymous'
  const limit = TIER_LIMITS[tier].activities
  const atLimit = activities.length >= limit

  function toggleActivity(preset: typeof PRESET_ACTIVITIES[number]) {
    if (activities.some(a => a.id === preset.id)) {
      setActivities(activities.filter(a => a.id !== preset.id))
    } else if (!atLimit) {
      setActivities([...activities, { ...preset }])
    }
  }

  function addCustomActivity() {
    if (!customName.trim() || atLimit) return
    setActivities([...activities, {
      id: `custom_${Date.now()}`, name: customName.trim(),
      icon: '✨', durationMins: customMins, maxUV: 4,
      sunscreen: false, custom: true,
    }])
    setCustomName(''); setCustomMins(30); setShowCustom(false)
  }

  async function handleGeolocate() {
    setLocLoad(true); setGeoError(null)
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords
      const city = await reverseGeocode(lat, lon)
      const loc = { lat, lon, ...city }
      setLocation(loc)
      setLocLoad(false)
      await fetchUVPreview(loc)
    }, () => {
      setGeoError('Location access denied. Type a city below.')
      setLocLoad(false)
    })
  }

  async function handleCitySearch() {
    if (!cityInput.trim()) return
    setLocLoad(true); setGeoError(null)
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput)}&count=1&language=en&format=json`)
      const data = await res.json()
      if (!data.results?.length) throw new Error('Not found')
      const r = data.results[0]
      const loc: Location = { lat: r.latitude, lon: r.longitude, city: r.name, region: r.admin1 ?? r.country ?? '' }
      setLocation(loc)
      await fetchUVPreview(loc)
    } catch {
      setGeoError('City not found. Try a different spelling.')
    } finally {
      setLocLoad(false)
    }
  }

  async function fetchUVPreview(loc: Location) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index&timezone=auto`)
      const data = await res.json()
      setUvNow(Math.round(data.current.uv_index * 10) / 10)
      setUvCity(loc.city)
      setStep('uvpreview')
    } catch {
      setStep('skin')
    }
  }

  async function handleFinish() {
    if (!location) return
    const prefs: UserPreferences = {
      ...defaultPrefs(location),
      skinType,
      activities,
      tier,
      onboardingComplete: true,
    }
    saveLocalPrefs(prefs)
    if (user) await saveFirestorePrefs(user.uid, { ...prefs, uid: user.uid })
    onComplete(prefs)
  }

  function uvLabel(uv: number) {
    if (uv < 1) return { label: 'None', color: '#9CA3AF' }
    if (uv <= 2) return { label: 'Low', color: '#16A34A' }
    if (uv <= 5) return { label: 'Moderate', color: '#D97706' }
    if (uv <= 7) return { label: 'High', color: '#EA580C' }
    if (uv <= 10) return { label: 'Very high', color: '#DC2626' }
    return { label: 'Extreme', color: '#9333EA' }
  }

  const stepNum = { location: 1, uvpreview: 1, skin: 2, activities: 3 }
  const totalSteps = 3

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span style={{ fontSize: '32px' }}>☀️</span>
          <h1 style={{ margin: '8px 0 4px', fontSize: '22px', fontWeight: 600, color: 'var(--text)' }}>Solara</h1>
          {step !== 'location' && step !== 'uvpreview' && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '12px' }}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} style={{
                  width: '28px', height: '4px', borderRadius: '2px',
                  background: i < (stepNum[step] - 1) ? 'var(--accent)' : i === (stepNum[step] - 1) ? 'var(--accent)' : 'var(--border-md)',
                  opacity: i < stepNum[step] ? 1 : 0.3,
                }} />
              ))}
            </div>
          )}
        </div>

        {step === 'location' && (
          <div className="card">
            <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>Where are you?</h2>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'var(--text-2)', lineHeight: '1.5' }}>
              We'll show you live UV data for your area — no sign-up needed.
            </p>
            <button className="btn btn-primary" onClick={handleGeolocate} disabled={locLoading}
              style={{ width: '100%', justifyContent: 'center', marginBottom: '12px', padding: '10px' }}>
              {locLoading ? 'Detecting...' : '📍 Use my location'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--border-md)' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>or type a city</span>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--border-md)' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                placeholder="e.g. Los Angeles"
                value={cityInput}
                onChange={e => setCityInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCitySearch()}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={handleCitySearch} disabled={locLoading}>Go</button>
            </div>
            {geoError && <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#DC2626' }}>{geoError}</p>}
          </div>
        )}

        {step === 'uvpreview' && uvNow !== null && (
          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: '13px', color: 'var(--text-3)' }}>UV index right now in</p>
            <p style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>{uvCity}</p>
            <div style={{ fontSize: '72px', fontWeight: 700, color: uvLabel(uvNow).color, lineHeight: 1, marginBottom: '8px' }}>
              {uvNow.toFixed(1)}
            </div>
            <div style={{ display: 'inline-block', padding: '4px 14px', borderRadius: '20px', background: 'var(--bg-metric)', fontSize: '14px', fontWeight: 500, color: uvLabel(uvNow).color, marginBottom: '24px' }}>
              {uvLabel(uvNow).label}
            </div>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: 'var(--text-2)', lineHeight: '1.6' }}>
              Set up your profile to see exactly when it's safe for your activities — based on your skin type.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn btn-primary" onClick={() => setStep('skin')} style={{ justifyContent: 'center', padding: '10px' }}>
                Set up my profile →
              </button>
              <button className="btn btn-ghost" onClick={handleFinish} style={{ justifyContent: 'center', fontSize: '13px', color: 'var(--text-3)' }}>
                Skip for now — just show the dashboard
              </button>
            </div>
          </div>
        )}

        {step === 'skin' && (
          <div className="card">
            <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>What's your skin type?</h2>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-2)' }}>
              This determines your burn time and safe UV thresholds.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {SKIN_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setSkinType(o.value)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 14px', borderRadius: '10px', textAlign: 'left',
                  border: skinType === o.value ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                  background: skinType === o.value ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>{o.label}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>{o.desc}</p>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-3)', whiteSpace: 'nowrap', marginLeft: '12px' }}>{o.burnTime}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => setStep('activities')} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              Next →
            </button>
          </div>
        )}

        {step === 'activities' && !user && (
          <div className="card">
            <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>Want activity recommendations?</h2>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.55 }}>
              {ACTIVITY_SIGNIN_BLURB} Activities need an account — signing in with Google is free.
            </p>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)', marginBottom: '16px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5 }}>
                Free with Google: <strong>{TIER_LIMITS.free.activities} activities</strong>, safe-window
                recommendations, and your UV windows on Google Calendar.
              </p>
              <GoogleSignInButton style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={() => setStep('skin')} style={{ flex: '0 0 auto' }}>← Back</button>
              <button className="btn btn-ghost" onClick={handleFinish} style={{ flex: 1, justifyContent: 'center', fontSize: '13px', color: 'var(--text-3)' }}>
                Skip for now — just show the UV dashboard
              </button>
            </div>
          </div>
        )}

        {step === 'activities' && user && (
          <div className="card">
            <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>What do you like to do outside?</h2>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-2)' }}>
              Pick up to {limit} {limit === 1 ? 'activity' : 'activities'} to start — fine-tune SPF, timing, and more later.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {STARTER_ACTIVITIES.map(p => {
                const sel    = activities.some(a => a.id === p.id)
                const locked = !sel && atLimit
                return (
                  <button key={p.id} onClick={() => toggleActivity(p)} disabled={locked} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px',
                    padding: '8px 12px', borderRadius: '10px', textAlign: 'left',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    border: sel ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                    background: sel ? 'rgba(249,115,22,0.07)' : 'var(--bg-card)',
                    opacity: locked ? 0.4 : 1, transition: 'all 0.12s',
                  }}>
                    <span style={{ fontSize: '18px' }}>{p.icon}</span>
                    <span style={{ fontSize: '13px', fontWeight: sel ? 600 : 400, color: sel ? 'var(--accent)' : 'var(--text)' }}>{p.name}</span>
                  </button>
                )
              })}
            </div>

            {!showCustom ? (
              <button
                onClick={() => setShowCustom(true)}
                disabled={atLimit}
                style={{ background: 'none', border: 'none', cursor: atLimit ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, color: atLimit ? 'var(--text-3)' : 'var(--accent)', padding: '4px 0', marginBottom: '8px' }}
              >
                + Make your own
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                <input
                  placeholder="e.g. Beach volleyball"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomActivity()}
                  autoFocus
                  style={{ flex: '1 1 160px', fontSize: '13px' }}
                />
                <input type="number" min="5" step="5" value={customMins} onChange={e => setCustomMins(Math.max(5, parseInt(e.target.value) || 5))} style={{ width: '64px', fontSize: '13px' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>min</span>
                <button className="btn btn-primary" onClick={addCustomActivity} disabled={!customName.trim()} style={{ fontSize: '13px' }}>Add</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="btn" onClick={() => setStep('skin')} style={{ flex: '0 0 auto' }}>← Back</button>
              <button className="btn btn-primary" onClick={handleFinish} style={{ flex: 1, justifyContent: 'center', padding: '10px' }}>
                Start using Solara
              </button>
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-3)' }}>
          Free with Google: {TIER_LIMITS.free.activities} activities + calendar sync · Pro: unlimited activities, notifications + 10-day forecast
        </p>
      </div>
    </div>
  )
}

async function reverseGeocode(lat: number, lon: number): Promise<{ city: string; region: string }> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
    const data = await res.json()
    return {
      city: data.address?.city || data.address?.town || data.address?.village || 'Your location',
      region: data.address?.state || data.address?.country || '',
    }
  } catch {
    return { city: 'Your location', region: '' }
  }
}
