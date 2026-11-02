'use client'
import { Check, House, LocateFixed, MapPin, Star, X } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { samePlace } from '@solara/core/coordinates'
import { distanceKm, nearby } from '@solara/core/travel'
import type { PlaceControls } from '@/lib/places'
import type { Location } from '@/lib/types'
import { clampShift } from '@/lib/viewport-clamp'
import DataAttribution from './DataAttribution'
import PlaceSearch, { type PlaceSearchMiss } from './PlaceSearch'
import m from '@/messages/setup'
import { withMessages } from '@/lib/i18n'

/**
 * The place menu under the header's place name (components/LocationPopover.tsx, ROADMAP
 * item 54): "Back to <home>" during a visit, home and the other saved places (the shown
 * one marked), saving the shown place or making it home, "Use my location" (which asks for
 * permission only when tapped) and the place search. Any place but home is shown as a
 * visit, on this device only; home changes only with "Set as home" or in Settings. It loads
 * on demand (components/deferred.tsx), as nobody sees it until they open it.
 */
export default function LocationPanel({
  id,
  places,
  anchorRef,
  onClose,
}: {
  id: string
  places: PlaceControls
  /** The place button, which the panel stays aligned with. */
  anchorRef: RefObject<HTMLDivElement | null>
  /** Closes the menu; `refocus` returns focus to the place name. */
  onClose: (options: { refocus: boolean }) => void
}) {
  const { home, shown, visiting, others, limit, signedIn } = places
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
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

  // Focus moves into the menu, to its first choice, so the keyboard and a screen reader
  // start where the places are; the search no longer takes it, so a phone's keyboard does
  // not open over the list.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])

  const saved = [home, ...others]
  const shownSaved = saved.some(place => samePlace(place, shown))
  const atLimit = saved.length >= limit

  function choose(place: Location) {
    places.show(place)
    onClose({ refocus: true })
  }

  function saveShown() {
    setNote(places.save(shown) ? null : m.placesFull(limit))
  }

  /** A place picked from the search: show it, and save it when there is room. */
  function choosePlace(place: Location) {
    setError(null)
    setQuery('')
    places.show(place)
    if (saved.some(p => samePlace(p, place)) || places.save(place)) {
      setNote(null)
      onClose({ refocus: true })
    } else {
      setNote(m.placesFull(limit))
    }
  }

  function placeMissed(reason: PlaceSearchMiss) {
    setNote(null)
    setError(reason === 'none' ? m.cityNotFound : m.searchUnavailable)
  }

  /** "Use my location": the only place this menu asks for location permission. */
  function geolocate() {
    setLoading(true)
    setError(null)
    setNote(null)
    async function resolvePosition(pos: GeolocationPosition) {
      try {
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        // A saved place nearby is the one to show, under its saved name.
        const near = saved
          .filter(place => nearby(here, place))
          .sort((a, b) => distanceKm(here, a) - distanceKm(here, b))[0]
        if (near) {
          choose(near)
          return
        }
        // The geocoding code loads only when someone looks a place up.
        const { locationFromCoordinates } = await withMessages(
          ['setup'],
          () => import('@/lib/geocoding'),
        )
        choose(await locationFromCoordinates(here.lat, here.lon))
      } catch {
        setError(m.couldNotResolve)
      } finally {
        setLoading(false)
      }
    }
    navigator.geolocation.getCurrentPosition(
      pos => void resolvePosition(pos),
      () => {
        setError(m.locationDenied)
        setLoading(false)
      },
    )
  }

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={headingId}
      // Never wider than the viewport minus a 12 px gutter on each side.
      className="absolute top-[calc(100%+6px)] z-[100] box-border w-[min(270px,calc(100vw-24px))] rounded-[14px] border-[0.5px] border-line-strong bg-surface-card p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
      style={{ left: shift }}
      data-testid="place-menu"
    >
      <h2
        id={headingId}
        className="mb-2.5 text-[12px] font-semibold tracking-[0.06em] text-ink uppercase"
      >
        {m.places}
      </h2>

      {visiting && (
        <button
          type="button"
          className="btn btn-primary mb-2.5 w-full justify-center text-[13px]"
          onClick={() => choose(home)}
        >
          <House size={15} aria-hidden="true" />
          <span className="min-w-0 truncate">{m.backToHome(home.city)}</span>
        </button>
      )}

      <ul className="mb-2.5 flex flex-col gap-1">
        {!shownSaved && (
          <li className="flex items-center gap-1.5">
            <PlaceButton place={shown} current onClick={() => onClose({ refocus: true })} />
            <button
              type="button"
              className="btn shrink-0 px-2 py-1 text-[11px]"
              onClick={saveShown}
              disabled={atLimit}
              title={atLimit ? m.limitReached(limit) : m.saveThisPlace}
              aria-label={m.saveThisPlace}
            >
              <Star size={12} aria-hidden="true" /> {m.save}
            </button>
          </li>
        )}
        {saved.map(place => {
          const isHome = place === home
          return (
            <li key={`${place.lat},${place.lon}`} className="flex items-center gap-1.5">
              <PlaceButton
                place={place}
                home={isHome}
                current={samePlace(place, shown)}
                onClick={() => choose(place)}
              />
              {!isHome && (
                <button
                  type="button"
                  onClick={() => places.remove(place)}
                  aria-label={m.removeNamed(place.city)}
                  title={m.removeNamed(place.city)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-metric"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {visiting && (
        <div className="mb-2.5">
          <button
            type="button"
            className="btn w-full justify-center text-[13px]"
            onClick={() => {
              places.setHome(shown)
              onClose({ refocus: true })
            }}
          >
            <House size={15} aria-hidden="true" /> {m.setAsHome}
          </button>
          <p className="mt-1.5 text-[11px] leading-[1.4] text-ink-3">
            {m.visitNote}
            {signedIn && <> {m.serverUsesHome(home.city)}</>}
          </p>
        </div>
      )}

      <button
        type="button"
        className="btn mb-2 w-full justify-center text-[13px]"
        onClick={geolocate}
        disabled={loading}
      >
        <LocateFixed size={15} aria-hidden="true" /> {loading ? m.detecting : m.useMyLocation}
      </button>
      <PlaceSearch
        ariaLabel={m.addCity}
        placeholder={m.addCityPlaceholder}
        value={query}
        onValueChange={value => {
          setQuery(value)
          setError(null)
        }}
        onSelect={choosePlace}
        onMiss={placeMissed}
        busy={loading}
        size="sm"
      />
      <p className="mt-2 text-[11px] text-ink-3">{m.placesCount(saved.length, limit)}</p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-1.5 text-[12px] text-ink-2">
          {note}
        </p>
      )}
      <DataAttribution compact className="mt-2.5 border-t-[0.5px] border-line-strong pt-2" />
    </div>
  )
}

/** A place in the menu: its name and region, "Home" for home, and "Showing" when shown. */
function PlaceButton({
  place,
  home = false,
  current,
  onClick,
}: {
  place: Location
  home?: boolean
  current: boolean
  onClick: () => void
}) {
  const Icon = home ? House : MapPin
  return (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      className={clsx(
        'flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-left',
        current ? 'border-brand/25 bg-brand/8' : 'border-transparent hover:bg-surface-metric',
      )}
    >
      <Icon
        size={15}
        aria-hidden="true"
        className={clsx('shrink-0', current ? 'text-accent' : 'text-ink-3')}
      />
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-[13px] text-ink', current && 'font-[650]')}>
          {place.city}
        </span>
        {(home || place.region) && (
          <span className="block truncate text-[11px] text-ink-3">
            {home ? (place.region ? `${m.home} · ${place.region}` : m.home) : place.region}
          </span>
        )}
      </span>
      {current && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-accent">
          <Check size={12} aria-hidden="true" />
          {m.showing}
        </span>
      )}
    </button>
  )
}
