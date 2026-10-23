'use client'
import { useState } from 'react'
import type { User } from 'firebase/auth'
import { saveLocalPrefs, defaultPrefs } from '@/lib/prefs'
import type { UserPreferences, Location, SkinType } from '@/lib/types'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'
import { searchLocation } from '@/lib/geocoding'
import GoogleSignInButton from './GoogleSignInButton'

interface Props {
  onComplete: (prefs: UserPreferences) => void
  user?: User | null
}

type Step = 'location' | 'uvpreview' | 'skin' | 'signin'

const SKIN_OPTIONS: { value: SkinType; label: string; desc: string; burnTime: string }[] = [
  { value: 'very-fair', label: 'Very fair', desc: 'Burns easily, rarely tans', burnTime: '~10m' },
  { value: 'fair', label: 'Fair', desc: 'Burns often, tans lightly', burnTime: '~15m' },
  { value: 'medium', label: 'Medium', desc: 'Burns sometimes, tans well', burnTime: '~25m' },
  { value: 'olive', label: 'Olive', desc: 'Rarely burns, tans easily', burnTime: '~35m' },
  { value: 'dark', label: 'Dark', desc: 'Very rarely burns', burnTime: '~50m' },
]

function uvLabel(uv: number) {
  if (uv < 1) return { label: 'None', color: '#9CA3AF' }
  if (uv <= 2) return { label: 'Low', color: '#16A34A' }
  if (uv <= 5) return { label: 'Moderate', color: '#D97706' }
  if (uv <= 7) return { label: 'High', color: '#EA580C' }
  if (uv <= 10) return { label: 'Very high', color: '#DC2626' }
  return { label: 'Extreme', color: '#9333EA' }
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('location')
  const [locLoading, setLocLoad] = useState(false)
  const [cityInput, setCityInput] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [uvNow, setUvNow] = useState<number | null>(null)
  const [uvCity, setUvCity] = useState('')
  const [skinType, setSkinType] = useState<SkinType>('fair')

  // Setup never scrolls — lock the page while onboarding is mounted (shared,
  // ref-counted hook so it composes with any other overlay's lock).
  useBodyScrollLock()

  const collected: UserPreferences | null = location
    ? { ...defaultPrefs(location), skinType, tier: 'free', onboardingComplete: true }
    : null

  async function handleGeolocate() {
    setLocLoad(true)
    setGeoError(null)
    async function resolvePosition(pos: GeolocationPosition) {
      const { latitude: lat, longitude: lon } = pos.coords
      const city = await reverseGeocode(lat, lon)
      const loc = { lat, lon, ...city }
      setLocation(loc)
      setLocLoad(false)
      await fetchUVPreview(loc)
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      () => {
        setGeoError('Location access denied. Type a city below.')
        setLocLoad(false)
      },
    )
  }

  async function handleCitySearch() {
    if (!cityInput.trim()) return
    setLocLoad(true)
    setGeoError(null)
    try {
      const loc = await searchLocation(cityInput)
      if (!loc) throw new Error('Not found')
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
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index&timezone=auto`,
      )
      const data = await res.json()
      setUvNow(Math.round(data.current.uv_index * 10) / 10)
      setUvCity(loc.city)
      setStep('uvpreview')
    } catch {
      setStep('skin')
    }
  }

  function finish() {
    if (!collected) return
    saveLocalPrefs(collected)
    onComplete(collected)
  }

  const progress = { location: 1, uvpreview: 1, skin: 2, signin: 3 }[step]

  return (
    <main
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '16px',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          margin: '0 auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: '6px 0 14px', flexShrink: 0 }}>
          <span style={{ fontSize: '26px' }}>☀️</span>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={progress}
            aria-valuetext={`Step ${progress} of 3`}
            style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '10px' }}
          >
            {[1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  width: '26px',
                  height: '4px',
                  borderRadius: '2px',
                  background: i <= progress ? 'var(--accent)' : 'var(--border-md)',
                  opacity: i <= progress ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        </div>

        {/* Step body fills the screen; the primary action sits pinned at the bottom (thumb zone). */}
        <div
          className="card"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {step === 'location' && (
            <>
              <h2
                style={{
                  margin: '0 0 6px',
                  fontSize: '19px',
                  fontWeight: 650,
                  color: 'var(--text)',
                }}
              >
                Where are you?
              </h2>
              <p
                style={{
                  margin: '0 0 18px',
                  fontSize: '14px',
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                We&apos;ll show the live UV index for your area.
              </p>
              <label
                htmlFor="onboarding-city"
                style={{
                  marginBottom: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}
              >
                City or location
              </label>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 14px' }}
              >
                <input
                  id="onboarding-city"
                  placeholder="Type a city, e.g. Los Angeles"
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleCitySearch()
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  onClick={() => void handleCitySearch()}
                  disabled={locLoading}
                >
                  Go
                </button>
              </div>
              {geoError && (
                <p role="alert" style={{ margin: '0 0 8px', fontSize: '12px', color: '#DC2626' }}>
                  {geoError}
                </p>
              )}
              <div style={{ marginTop: 'auto' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleGeolocate()}
                  disabled={locLoading}
                  style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                >
                  {locLoading ? 'Detecting…' : '📍 Use my location'}
                </button>
              </div>
            </>
          )}

          {step === 'uvpreview' && uvNow !== null && (
            <>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  minHeight: 0,
                }}
              >
                <p style={{ margin: '0 0 2px', fontSize: '13px', color: 'var(--text-3)' }}>
                  UV index right now in
                </p>
                <p
                  style={{
                    margin: '0 0 14px',
                    fontSize: '16px',
                    fontWeight: 650,
                    color: 'var(--text)',
                  }}
                >
                  {uvCity}
                </p>
                <div
                  style={{
                    fontSize: '68px',
                    fontWeight: 750,
                    color: uvLabel(uvNow).color,
                    lineHeight: 1,
                    marginBottom: '10px',
                  }}
                >
                  {uvNow.toFixed(1)}
                </div>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '4px 14px',
                    borderRadius: '20px',
                    background: 'var(--bg-metric)',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: uvLabel(uvNow).color,
                    marginBottom: '18px',
                  }}
                >
                  {uvLabel(uvNow).label}
                </div>
                <p
                  style={{ margin: 0, fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.55 }}
                >
                  Next, set your skin type so Solara can personalize its planning estimates.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setStep('skin')}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '13px',
                  marginTop: '14px',
                }}
              >
                Continue →
              </button>
            </>
          )}

          {step === 'skin' && (
            <>
              <h2
                style={{
                  margin: '0 0 4px',
                  fontSize: '19px',
                  fontWeight: 650,
                  color: 'var(--text)',
                }}
              >
                Your skin type
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-2)' }}>
                Personalizes estimated burn time and planning UV limits.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {SKIN_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    aria-pressed={skinType === o.value}
                    onClick={() => setSkinType(o.value)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 13px',
                      borderRadius: '10px',
                      textAlign: 'left',
                      border:
                        skinType === o.value
                          ? '1.5px solid var(--accent)'
                          : '0.5px solid var(--border-md)',
                      background: skinType === o.value ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        {o.label}
                      </p>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
                        {o.desc}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-3)',
                        whiteSpace: 'nowrap',
                        marginLeft: '12px',
                      }}
                    >
                      {o.burnTime}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setStep('signin')}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '13px',
                  marginTop: 'auto',
                }}
              >
                Continue →
              </button>
            </>
          )}

          {step === 'signin' && (
            <>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  minHeight: 0,
                }}
              >
                <span style={{ fontSize: '34px', marginBottom: '12px' }}>🔒</span>
                <h2
                  style={{
                    margin: '0 0 8px',
                    fontSize: '20px',
                    fontWeight: 650,
                    color: 'var(--text)',
                  }}
                >
                  Sign in to finish
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    color: 'var(--text-2)',
                    lineHeight: 1.55,
                    maxWidth: '300px',
                  }}
                >
                  Solara saves your setup to your account so your sun windows are ready on every
                  device.
                </p>
              </div>
              <div style={{ marginTop: '14px' }}>
                <GoogleSignInButton
                  label="Continue with Google"
                  seedPrefs={collected}
                  onSignedIn={finish}
                  style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setStep('skin')}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    marginTop: '8px',
                    fontSize: '13px',
                    color: 'var(--text-3)',
                  }}
                >
                  ← Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{ city: string; region: string; timezone?: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
    )
    const data = await res.json()
    return {
      city: data.address?.city || data.address?.town || data.address?.village || 'Your location',
      region: data.address?.state || data.address?.country || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  } catch {
    return { city: 'Your location', region: '' }
  }
}
