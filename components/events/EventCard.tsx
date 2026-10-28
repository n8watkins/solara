'use client'
import { useId, useState } from 'react'
import { CalendarDays, CalendarSync, ExternalLink, MapPin, X } from 'lucide-react'
import clsx from 'clsx'
import { stripInvisibleFormatting, type ImportedEvent } from '@solara/core/event-import'
import { eventCardView } from '@/lib/event-view'
import { samePlace } from '@/lib/events'
import { useWeather } from '@/lib/use-forecast'
import { useUnits } from '@/lib/use-units'
import type { Activity, Location, Profile, SkinType, WeatherResponse } from '@/lib/types'
import PlaceSearch, { type PlaceSearchMiss } from '../PlaceSearch'
import { UV_BG } from '../dashboard/uv-classes'

interface Props {
  item: ImportedEvent
  /** The forecast at the person's own place (shared with the dashboard). */
  home: Location
  homeWeather: WeatherResponse
  activities: readonly Activity[]
  skinType: SkinType
  mostSensitive: Pick<Profile, 'name'> | null
  planDays: number
  nowMs: number
  /** Opens the plans dialog, for an event Pro would already show. */
  onUpgrade?: () => void
  onSetPlace: (item: ImportedEvent, place: Location) => Promise<void>
  onSetActivity: (item: ImportedEvent, activityId: string) => Promise<void>
  onRemove: (item: ImportedEvent) => void
}

const SMALL_BUTTON = 'btn px-2.5 py-[5px] text-[12px]'

/**
 * One imported event: the UV during it at its place, the burn estimate for the
 * planning skin type, sunscreen timing, and the fixes the person can make (the place,
 * which activity it counts as).
 */
export default function EventCard({
  item,
  home,
  homeWeather,
  activities,
  skinType,
  mostSensitive,
  planDays,
  nowMs,
  onUpgrade,
  onSetPlace,
  onSetActivity,
  onRemove,
}: Props) {
  const fmt = useUnits()
  const id = useId()
  const atHome = samePlace(item, home)
  // Another place's forecast comes from the shared forecast store (one request per place).
  const remote = useWeather(
    atHome
      ? null
      : {
          lat: item.lat,
          lon: item.lon,
          city: item.placeLabel,
          region: '',
          timezone: item.timeZone,
        },
  )
  const weather = atHome ? homeWeather : remote.weather
  const activity = activities.find(a => a.id === item.activityId) ?? null
  const view = eventCardView({
    item,
    weather,
    activity,
    skinType,
    mostSensitive,
    planDays,
    nowMs,
    fmt,
  })
  const [editingPlace, setEditingPlace] = useState(false)
  const [query, setQuery] = useState('')
  const [placeError, setPlaceError] = useState<string | null>(null)
  // Events stored before the importer removed bidi controls are cleaned here too (L2).
  const title = stripInvisibleFormatting(item.title) || 'Untitled event'
  const placeName = stripInvisibleFormatting(item.placeLabel)
  const where = stripInvisibleFormatting(item.where)

  async function choosePlace(place: Location) {
    setPlaceError(null)
    try {
      await onSetPlace(item, place)
      setEditingPlace(false)
      setQuery('')
    } catch {
      setPlaceError('Could not save the place. Try again.')
    }
  }

  function missed(reason: PlaceSearchMiss) {
    setPlaceError(
      reason === 'none' ? 'No place found by that name.' : 'Place search is not available.',
    )
  }

  const titleId = `${id}-title`
  return (
    <li
      className="@container rounded-[12px] border-[0.5px] border-line-strong bg-surface-card px-3 py-3"
      aria-labelledby={titleId}
      data-testid="event-card"
      data-event-key={item.key}
    >
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            'flex w-[54px] shrink-0 flex-col items-center rounded-[10px] px-1 py-1.5 text-center',
            view.badge ? `${UV_BG[view.badge.band]} text-uv-ink` : 'bg-surface-metric text-ink-3',
          )}
          aria-hidden="true"
        >
          <span className="text-[10px] leading-none font-semibold tracking-[0.04em] uppercase">
            UV
          </span>
          <span className="mt-1 text-[18px] leading-none font-bold tabular-nums">
            {view.badge?.value ?? '–'}
          </span>
          <span className="mt-1 text-[10px] leading-tight font-semibold">
            {view.badge?.label ?? (view.later ? 'Later' : weather ? 'Unknown' : '…')}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-[14px] leading-snug font-semibold break-words text-ink">
            {title}
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-2 tabular-nums">{view.when}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-ink-3">
            <MapPin size={12} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {item.placeGuessed ? `Using ${placeName}` : placeName}
            </span>
          </p>
          {item.source === 'feed' && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-ink-3">
              <CalendarSync size={12} className="shrink-0" aria-hidden="true" />
              From a linked calendar
            </p>
          )}
          {item.source === 'google' && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-ink-3">
              <CalendarDays size={12} className="shrink-0" aria-hidden="true" />
              From Google Calendar
            </p>
          )}
        </div>
        {/* A linked calendar's or Google Calendar's event would come back at its next
            refresh, so it goes with its calendar (below the list). */}
        {item.source === 'file' && (
          <button
            type="button"
            className="btn btn-ghost -mt-1 -mr-1.5 shrink-0 p-1.5 text-ink-3"
            aria-label={`Remove ${title}`}
            onClick={() => onRemove(item)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {(view.later || view.peak || view.burn || view.sunscreen || !weather) && (
        <div className="mt-2.5 flex flex-col gap-1 text-[12px] leading-[1.45] text-ink-2">
          {!weather && <p className="text-ink-3">Loading the forecast…</p>}
          {view.later && (
            <p>
              {view.later}.
              {onUpgrade && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="font-semibold text-accent underline underline-offset-2"
                    onClick={onUpgrade}
                  >
                    See it now with Pro
                  </button>
                </>
              )}
            </p>
          )}
          {view.peak && <p>{view.peak}</p>}
          {view.burn && <p>{view.burn}</p>}
          {view.sunscreen && <p>{view.sunscreen}</p>}
          {view.confidence && <p className="text-ink-3">{view.confidence}.</p>}
        </div>
      )}

      {item.placeGuessed && !editingPlace && (
        <p className="mt-2.5 rounded-[9px] bg-surface-metric px-2.5 py-2 text-[12px] leading-[1.45] text-ink-2">
          {where
            ? `Solara could not find “${where}”, so this uses your place.`
            : 'The event has no place, so this uses your place.'}{' '}
          <button
            type="button"
            className="font-semibold text-accent underline underline-offset-2"
            onClick={() => setEditingPlace(true)}
          >
            Set the place
          </button>
        </p>
      )}

      {editingPlace && (
        <div className="mt-2.5">
          <PlaceSearch
            ariaLabel={`Place for ${title}`}
            placeholder="Search a city…"
            value={query}
            onValueChange={setQuery}
            onSelect={place => void choosePlace(place)}
            onMiss={missed}
            size="sm"
            autoFocus
          />
          {placeError && (
            <p role="alert" className="mt-1.5 text-[12px] text-danger">
              {placeError}
            </p>
          )}
          <button
            type="button"
            className={`${SMALL_BUTTON} mt-2`}
            onClick={() => {
              setEditingPlace(false)
              setPlaceError(null)
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t-[0.5px] border-line pt-2.5">
        {/* On a narrow card "Counts as" takes its own row, so the buttons always line up
            on the next one instead of wrapping one by one. */}
        <label className="flex w-full min-w-0 items-center gap-1.5 text-[12px] text-ink-3 @md:w-auto">
          Counts as
          <select
            className="max-w-[170px] min-w-0 px-2 py-1 text-[12px]"
            value={activity ? activity.id : ''}
            onChange={e => void onSetActivity(item, e.target.value)}
          >
            <option value="">No activity (open sun)</option>
            {activities.map(a => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </label>
        {!item.placeGuessed && !editingPlace && (
          <button type="button" className={SMALL_BUTTON} onClick={() => setEditingPlace(true)}>
            Change place
          </button>
        )}
        {item.url && (
          <a
            className={`${SMALL_BUTTON} no-underline`}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Event page for ${title}`}
          >
            Event page <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        {view.exposure && <p className="w-full text-[11px] text-ink-3">{view.exposure}</p>}
      </div>
    </li>
  )
}
