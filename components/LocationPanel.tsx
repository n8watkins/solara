'use client'
import { MapPin, Star, X } from 'lucide-react'
import { useState, useRef, useLayoutEffect, type RefObject } from 'react'
import type { Location } from '@/lib/types'
import { clampShift } from '@/lib/viewport-clamp'
import DataAttribution from './DataAttribution'
import PlaceSearch, { type PlaceSearchMiss } from './PlaceSearch'

function sameLoc(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01
}

/**
 * The location panel under the header's place button (components/LocationPopover.tsx):
 * the active place, saved shortcuts, "Use my location" and the place search. It loads
 * on demand (components/deferred.tsx), as nobody sees it until they open it.
 */
export default function LocationPanel({
  location,
  savedLocations,
  limit,
  onApply,
  anchorRef,
  onClose,
}: {
  location: Location
  savedLocations: Location[]
  /** Max saved shortcuts for the current tier. */
  limit: number
  onApply: (next: { location: Location; savedLocations: Location[] }) => void
  /** The place button, which the panel stays aligned with. */
  anchorRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Horizontal nudge that keeps the panel inside the viewport wherever the
  // trigger sits in the header.
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    function clamp() {
      const panel = panelRef.current
      const anchor = anchorRef.current
      if (!panel || !anchor) return
      setShift(
        clampShift(anchor.getBoundingClientRect().left, panel.offsetWidth, window.innerWidth),
      )
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [anchorRef])

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
    if (!atLimit) setTimeout(onClose, 800)
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
        // The geocoding code loads only when someone looks a place up.
        const { locationFromCoordinates } = await import('@/lib/geocoding')
        const loc = await locationFromCoordinates(pos.coords.latitude, pos.coords.longitude)
        activate(loc, false) // current location switches but isn't auto-saved
        setTimeout(onClose, 800)
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
        <MapPin size={15} className="shrink-0 text-accent" />
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
            <Star size={12} /> Save
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
                className="flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-metric"
              >
                <X size={15} />
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
        <MapPin size={15} /> {loading ? 'Detecting…' : 'Use my location'}
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
  )
}
