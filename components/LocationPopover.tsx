'use client'
import { useState, useRef, useEffect } from 'react'
import type { Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import { searchLocation } from '@/lib/geocoding'

interface Props {
  location: Location
  savedLocations: Location[]
  /** Max saved shortcuts for the current tier. */
  limit: number
  onApply: (next: { location: Location; savedLocations: Location[] }) => void
}

function sameLoc(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

export default function LocationPopover({ location, savedLocations, limit, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const activeSaved = savedLocations.some(l => sameLoc(l, location))
  const atLimit = savedLocations.length >= limit
  // Shortcuts to show, with the active one excluded (it's pinned at the top).
  const otherSaved = savedLocations.filter(l => !sameLoc(l, location))

  /** Switch the active location, optionally saving it as a shortcut. */
  function activate(loc: Location, save: boolean) {
    const already = savedLocations.some(l => sameLoc(l, loc))
    let saved = savedLocations
    if (save && !already) {
      if (savedLocations.length >= limit) {
        setNote(`Saved-location limit reached (${limit}). Remove one or upgrade to save more.`)
      } else {
        saved = [...savedLocations, loc]
      }
    }
    clearWeatherCache()
    onApply({ location: loc, savedLocations: saved })
  }

  function removeShortcut(loc: Location) {
    onApply({ location, savedLocations: savedLocations.filter(l => !sameLoc(l, loc)) })
  }

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setNote(null)
    try {
      const loc = await searchLocation(query)
      if (!loc) throw new Error('Not found')
      activate(loc, true) // searching a new city saves it as a shortcut when there's room
      setQuery('')
      if (!atLimit) setTimeout(() => setOpen(false), 800)
    } catch {
      setError('City not found.')
    } finally {
      setLoading(false)
    }
  }

  async function geolocate() {
    setLoading(true)
    setError(null)
    setNote(null)
    async function resolvePosition(pos: GeolocationPosition) {
      try {
        const { latitude: lat, longitude: lon } = pos.coords
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        )
        const data = await res.json()
        const city =
          data.address?.city || data.address?.town || data.address?.village || 'Your location'
        const region = data.address?.state || ''
        activate(
          { lat, lon, city, region, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          false,
        ) // current location switches but isn't auto-saved
        setTimeout(() => setOpen(false), 800)
      } catch {
        setError('Could not resolve.')
      } finally {
        setLoading(false)
      }
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      () => {
        setError('Location denied.')
        setLoading(false)
      },
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: '13px',
          color: 'var(--text-3)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '3px 7px',
          borderRadius: '6px',
          transition: 'background 0.1s',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          maxWidth: '100%',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        📍{' '}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {location.city}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border-md)',
            borderRadius: '14px',
            padding: '14px',
            width: '270px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          <p
            style={{
              margin: '0 0 10px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Location
          </p>

          {/* Active location, pinned. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '10px',
              background: 'rgba(249,115,22,0.08)',
              border: '1px solid rgba(249,115,22,0.25)',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '13px' }}>📍</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '13px',
                  fontWeight: 650,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {location.city}
              </p>
              {location.region && (
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-3)' }}>
                  {location.region}
                </p>
              )}
            </div>
            {!activeSaved && (
              <button
                className="btn"
                onClick={() => activate(location, true)}
                disabled={atLimit}
                title={atLimit ? `Limit reached (${limit})` : 'Save as a shortcut'}
                style={{ fontSize: '11px', padding: '4px 8px', opacity: atLimit ? 0.5 : 1 }}
              >
                ☆ Save
              </button>
            )}
          </div>

          {/* Saved shortcuts. */}
          {otherSaved.length > 0 && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}
            >
              {otherSaved.map(loc => (
                <div
                  key={`${loc.lat},${loc.lon}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <button
                    onClick={() => activate(loc, false)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: 'var(--text-2)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {loc.city}
                    {loc.region ? `, ${loc.region}` : ''}
                  </button>
                  <button
                    onClick={() => removeShortcut(loc)}
                    aria-label={`Remove ${loc.city}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-3)',
                      fontSize: '14px',
                      padding: '4px 6px',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn"
            onClick={() => void geolocate()}
            disabled={loading}
            style={{
              width: '100%',
              justifyContent: 'center',
              marginBottom: '8px',
              fontSize: '13px',
            }}
          >
            📍 {loading ? 'Detecting…' : 'Use my location'}
          </button>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              placeholder="Add a city…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void search()
              }}
              style={{ flex: 1, fontSize: '13px', padding: '7px 10px' }}
              autoFocus
            />
            <button
              className="btn"
              onClick={() => void search()}
              disabled={loading}
              style={{ fontSize: '13px', padding: '7px 12px' }}
            >
              {loading ? '…' : 'Go'}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
            {savedLocations.length}/{limit} saved
          </p>
          {error && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#DC2626' }}>{error}</p>
          )}
          {note && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-2)' }}>{note}</p>
          )}
        </div>
      )}
    </div>
  )
}
