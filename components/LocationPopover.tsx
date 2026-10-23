'use client'
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { Location } from '@/lib/types'
import { clearWeatherCache } from '@/lib/cache'
import { locationFromCoordinates, searchLocation } from '@/lib/geocoding'
import DataAttribution from './DataAttribution'
import styles from './LocationPopover.module.css'

/** Minimum gap between the panel and the viewport edge. */
const VIEWPORT_GUTTER = 12

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
  const panelRef = useRef<HTMLDivElement>(null)
  // Horizontal nudge that keeps the panel inside the viewport wherever the
  // trigger sits in the header.
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    if (!open) return
    function clamp() {
      const panel = panelRef.current
      const anchor = ref.current
      if (!panel || !anchor) return
      const left = anchor.getBoundingClientRect().left
      const width = panel.offsetWidth
      const maxLeft = window.innerWidth - VIEWPORT_GUTTER - width
      const target = Math.max(VIEWPORT_GUTTER, Math.min(left, maxLeft))
      setShift(target - left)
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [open])

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
        const loc = await locationFromCoordinates(pos.coords.latitude, pos.coords.longitude)
        activate(loc, false) // current location switches but isn't auto-saved
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
      <button className={styles.trigger} onClick={() => setOpen(o => !o)}>
        📍{' '}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {location.city}
        </span>
      </button>

      {open && (
        <div ref={panelRef} className={styles.panel} style={{ left: shift }}>
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
                  <button className={styles.shortcut} onClick={() => activate(loc, false)}>
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
              aria-label="Add a city"
              style={{ flex: 1, minWidth: 0, fontSize: '13px', padding: '7px 10px' }}
              autoFocus
            />
            <button
              className="btn"
              onClick={() => void search()}
              disabled={loading}
              style={{ flexShrink: 0, fontSize: '13px', padding: '7px 12px' }}
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
          <DataAttribution
            compact
            style={{
              marginTop: '10px',
              paddingTop: '8px',
              borderTop: '0.5px solid var(--border-md)',
            }}
          />
        </div>
      )}
    </div>
  )
}
