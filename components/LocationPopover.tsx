'use client'
import { useState, useRef, useEffect } from 'react'
import { Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'

interface Props {
  location: Location
  onUpdate: (loc: Location) => void
}

export default function LocationPopover({ location, onUpdate }: Props) {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function search() {
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`)
      const data = await res.json()
      if (!data.results?.length) throw new Error('Not found')
      const r = data.results[0]
      const loc: Location = { lat: r.latitude, lon: r.longitude, city: r.name, region: r.admin1 ?? r.country ?? '' }
      clearWeatherCache()
      onUpdate(loc)
      setSuccess(true)
      setTimeout(() => { setSuccess(false); setOpen(false); setQuery('') }, 1000)
    } catch {
      setError('City not found.')
    } finally { setLoading(false) }
  }

  async function geolocate() {
    setLoading(true); setError(null)
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords
        const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
        const data = await res.json()
        const city   = data.address?.city || data.address?.town || data.address?.village || 'Your location'
        const region = data.address?.state || ''
        clearWeatherCache()
        onUpdate({ lat, lon, city, region })
        setSuccess(true)
        setTimeout(() => { setSuccess(false); setOpen(false) }, 1000)
      } catch { setError('Could not resolve.') }
      finally   { setLoading(false) }
    }, () => { setError('Location denied.'); setLoading(false) })
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: '13px', color: 'var(--text-3)', background: 'none', border: 'none',
          cursor: 'pointer', padding: '3px 7px', borderRadius: '6px', transition: 'background 0.1s',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        📍 {location.city}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '0.5px solid var(--border-md)',
          borderRadius: '14px', padding: '14px', width: '260px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Change location
          </p>
          <button
            className="btn"
            onClick={geolocate}
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginBottom: '8px', fontSize: '13px' }}
          >
            📍 {loading ? 'Detecting…' : 'Use my location'}
          </button>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              placeholder="Search city…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              style={{ flex: 1, fontSize: '13px', padding: '7px 10px' }}
              autoFocus
            />
            <button className="btn" onClick={search} disabled={loading} style={{ fontSize: '13px', padding: '7px 12px' }}>
              {loading ? '…' : 'Go'}
            </button>
          </div>
          {error   && <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#DC2626' }}>{error}</p>}
          {success && <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#16A34A' }}>✓ Updated</p>}
        </div>
      )}
    </div>
  )
}
