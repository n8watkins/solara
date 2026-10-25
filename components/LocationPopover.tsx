'use client'
import { useState, useRef, useLayoutEffect } from 'react'
import type { Location } from '@/lib/types'
import { locationFromCoordinates } from '@/lib/geocoding'
import { useOutsideClick } from '@/lib/use-outside-click'
import { clampShift } from '@/lib/viewport-clamp'
import DataAttribution from './DataAttribution'
import PlaceSearch, { type PlaceSearchMiss } from './PlaceSearch'

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
      setShift(
        clampShift(anchor.getBoundingClientRect().left, panel.offsetWidth, window.innerWidth),
      )
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [open])

  useOutsideClick(ref, open, () => setOpen(false))

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
    onApply({ location: loc, savedLocations: saved })
  }

  function removeShortcut(loc: Location) {
    onApply({ location, savedLocations: savedLocations.filter(l => !sameLoc(l, loc)) })
  }

  /** A place picked from the search: switch to it and save it as a shortcut when there's room. */
  function choosePlace(loc: Location) {
    setError(null)
    setNote(null)
    activate(loc, true)
    setQuery('')
    if (!atLimit) setTimeout(() => setOpen(false), 800)
  }

  function placeMissed(reason: PlaceSearchMiss) {
    setNote(null)
    setError(reason === 'none' ? 'City not found.' : 'Search is unavailable. Try again.')
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
    <div ref={ref} className="relative inline-block">
      <button
        className="flex max-w-full items-center gap-1 rounded-md px-[7px] py-[3px] text-[13px] text-ink-3 transition-colors duration-100 hover:bg-surface-metric"
        onClick={() => setOpen(o => !o)}
      >
        📍 <span className="truncate">{location.city}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          // Never wider than the viewport minus a 12 px gutter on each side.
          className="absolute top-[calc(100%+6px)] z-[100] box-border w-[min(270px,calc(100vw-24px))] rounded-[14px] border-[0.5px] border-line-strong bg-surface-card p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
          style={{ left: shift }}
        >
          <p className="mb-2.5 text-[12px] font-semibold tracking-[0.06em] text-ink uppercase">
            Location
          </p>

          {/* Active location, pinned. */}
          <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-brand/25 bg-brand/8 px-2.5 py-2">
            <span className="text-[13px]">📍</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-[650] text-ink">{location.city}</p>
              {location.region && <p className="text-[11px] text-ink-3">{location.region}</p>}
            </div>
            {!activeSaved && (
              <button
                className="btn px-2 py-1 text-[11px]"
                onClick={() => activate(location, true)}
                disabled={atLimit}
                title={atLimit ? `Limit reached (${limit})` : 'Save as a shortcut'}
              >
                ☆ Save
              </button>
            )}
          </div>

          {/* Saved shortcuts. */}
          {otherSaved.length > 0 && (
            <div className="mb-2.5 flex flex-col gap-1">
              {otherSaved.map(loc => (
                <div key={`${loc.lat},${loc.lon}`} className="flex items-center gap-1.5">
                  <button
                    className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-metric"
                    onClick={() => activate(loc, false)}
                  >
                    {loc.city}
                    {loc.region ? `, ${loc.region}` : ''}
                  </button>
                  <button
                    onClick={() => removeShortcut(loc)}
                    aria-label={`Remove ${loc.city}`}
                    className="px-1.5 py-1 text-[14px] text-ink-3"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn mb-2 w-full justify-center text-[13px]"
            onClick={() => void geolocate()}
            disabled={loading}
          >
            📍 {loading ? 'Detecting…' : 'Use my location'}
          </button>
          <PlaceSearch
            ariaLabel="Add a city"
            placeholder="Add a city…"
            value={query}
            onValueChange={value => {
              setQuery(value)
              setError(null)
            }}
            onSelect={choosePlace}
            onMiss={placeMissed}
            busy={loading}
            size="sm"
            autoFocus
          />
          <p className="mt-2 text-[11px] text-ink-3">
            {savedLocations.length}/{limit} saved
          </p>
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          {note && <p className="mt-1.5 text-[12px] text-ink-2">{note}</p>}
          <DataAttribution compact className="mt-2.5 border-t-[0.5px] border-line-strong pt-2" />
        </div>
      )}
    </div>
  )
}
