'use client'
// The dashboard's Events section (docs/integrations/EVENTS.md, phase 1): import an .ics
// file and see the UV during each upcoming event. Loaded on demand for signed-in
// accounts only (components/deferred.tsx), so nothing here is in a guest's first load.
import { lazy, Suspense, useContext, useEffect, useId, useRef, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import {
  firestoreEventsStore,
  geocodingLookups,
  importIcsFile,
  importSummary,
  upcomingEvents,
  withPlace,
  type EventsSnapshot,
  type ImportedEvent,
} from '@/lib/events'
import { EventsStoreContext } from '@/lib/events-context'
import { listInWords } from '@/lib/account-data'
import { capMessage } from '@/lib/record-cap'
import { planningFor } from '@solara/core'
import { IMPORTED_EVENT_LIMITS } from '@solara/core/event-import'
import {
  eventHeadsUpsLaunched,
  eventSubscriptionsLaunched,
  googleCalendarEventsLaunched,
  outlookCalendarEventsLaunched,
} from '@/lib/plans'
import { eventHeadsUpRule } from '@/lib/event-heads-up-copy'
import { getFutureDays } from '@solara/core/tiers'
import type { Location, TierLevel, UserPreferences, WeatherResponse } from '@/lib/types'
import EventCard from './EventCard'
import core from '@solara/core/messages/core'
import m from '@/messages/events'

// Linked calendars load only where they are switched on (docs/integrations/EVENTS.md).
const EventSubscriptions = lazy(() => import('./EventSubscriptions'))
// So do events already in Google Calendar (phase 2b).
const GoogleCalendarEvents = lazy(() => import('./GoogleCalendarEvents'))
// And events already in Outlook, with their Microsoft sign-in (ROADMAP item 23).
const OutlookCalendarEvents = lazy(() => import('./OutlookCalendarEvents'))

/** How the note under "Remove imported events" names the calendars whose events stay. */
const KEPT_SOURCE_NAMES = {
  feed: () => m.linkedCalendars,
  google: () => m.googleCalendar,
  outlook: () => m.outlook,
} as const

/** Events shown before "Show all". */
const FIRST_SHOWN = 5

interface Props {
  uid: string
  prefs: UserPreferences
  /** The forecast at the person's place, as the dashboard shows it. */
  weather: WeatherResponse
  /** The tier whose forecast days apply (a preview tier may override the account's). */
  displayTier: TierLevel
  /** Opens the Pro plans; absent in an app store build, which offers nothing to buy. */
  onUpgrade?: () => void
  /** A calendar link shared to the app (components/events/SharedItem.tsx), for the form. */
  sharedLink?: string | null
}

export default function EventsSection({
  uid,
  prefs,
  weather,
  displayTier,
  onUpgrade,
  sharedLink,
}: Props) {
  const store = useContext(EventsStoreContext) ?? firestoreEventsStore
  const headingId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [snapshot, setSnapshot] = useState<EventsSnapshot | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  useEffect(
    () =>
      store.subscribe(
        uid,
        Date.now(),
        next => {
          setSnapshot(next)
          setLoadError(false)
        },
        () => setLoadError(true),
      ),
    [store, uid],
  )
  // Events that ended over 30 days ago are pruned on every signed-in visit by
  // components/App.tsx (lib/retention.ts), not only when this section shows.

  const nowMs = weather.now.epochMs
  const items = snapshot?.items ?? null
  const stored = snapshot?.stored ?? 0
  const full = stored >= IMPORTED_EVENT_LIMITS.maxStored
  const upcoming = upcomingEvents(items ?? [], nowMs)
  const shown = showAll ? upcoming : upcoming.slice(0, FIRST_SHOWN)
  const planning = planningFor(prefs)
  const planDays = getFutureDays(displayTier)
  const location = prefs.location as Location
  const busy = progress !== null
  // Events from a file may be stored: one is loaded, or the account holds more than loaded.
  const mayHoldImported =
    (items ?? []).some(item => item.source === 'file') || stored > (items?.length ?? 0)
  // The calendars whose events "Remove imported events" keeps, as the loaded events show them.
  const keptSources = (['feed', 'google', 'outlook'] as const)
    .filter(source => (items ?? []).some(item => item.source === source))
    .map(source => KEPT_SOURCE_NAMES[source]())

  async function importFile(file: File) {
    setStatus(null)
    setProgress(m.readingFile)
    const outcome = await importIcsFile(file, {
      home: location,
      activities: prefs.activities,
      existing: items ?? [],
      nowMs: Date.now(),
      lookups: geocodingLookups,
      seriesEvents: seriesIds => store.seriesEvents(uid, seriesIds),
      save: records => store.save(uid, records),
      remove: keys => store.remove(uid, keys),
      onProgress: setProgress,
    })
    setProgress(null)
    setStatus(
      outcome.ok ? { text: importSummary(outcome) } : { text: outcome.message, error: true },
    )
  }

  /** Every stored occurrence of the event's series (a fix applies to all of them). */
  const seriesOf = (item: ImportedEvent) =>
    (items ?? []).filter(other => other.seriesId === item.seriesId && other.where === item.where)

  async function setPlace(item: ImportedEvent, place: Location) {
    const now = new Date().toISOString()
    const series = seriesOf(item)
    await store.save(
      uid,
      series.map(other => withPlace(other, place, now)),
    )
    setStatus({
      text: series.length > 1 ? m.placeSetFor(place.city, series.length) : m.placeSet(place.city),
    })
  }

  async function setActivity(item: ImportedEvent, activityId: string) {
    const now = new Date().toISOString()
    try {
      await store.save(
        uid,
        seriesOf(item).map(other => ({ ...other, activityId, updatedAt: now })),
      )
    } catch {
      setStatus({ text: m.couldNotSaveChange, error: true })
    }
  }

  async function remove(keys: string[], done: string) {
    try {
      await store.remove(uid, keys)
      setStatus({ text: done })
    } catch {
      setStatus({ text: m.couldNotRemove, error: true })
    }
  }

  /**
   * Removes every event imported from a file, not only the ones loaded (REVIEW4 M3). Linked
   * and Google Calendar events stay: their next refresh would bring them back (REVIEW5 L2).
   */
  async function removeImported() {
    setStatus(null)
    setProgress(m.removingEvents)
    try {
      await store.removeImported(uid)
      setStatus({ text: m.removedAllImported })
    } catch {
      setStatus({ text: m.couldNotRemoveAll, error: true })
    } finally {
      setProgress(null)
    }
  }

  return (
    <section className="card" aria-labelledby={headingId} data-testid="events-section">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-[16px] font-bold text-ink">
          {m.events}
        </h2>
        <button
          type="button"
          className="btn shrink-0 px-3.5 py-2 text-[13px]"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <CalendarPlus size={15} aria-hidden="true" />
          {m.importIcs}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          hidden
          aria-label={m.fileToImport}
          data-testid="events-file"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>
      <p className="mt-1 text-[13px] leading-normal text-ink-3">
        {m.eventsLead(eventSources(displayTier === 'paid'))}
      </p>

      {(progress || status || loadError) && (
        <p
          data-testid="events-status"
          role={status?.error || (loadError && !progress && !status) ? 'alert' : 'status'}
          className={`mt-3 rounded-[10px] px-3 py-2 text-[13px] leading-normal ${
            status?.error || (loadError && !progress && !status)
              ? 'bg-danger/8 text-danger'
              : 'bg-brand/8 text-ink-2'
          }`}
        >
          {progress ?? status?.text ?? m.couldNotLoad}
        </p>
      )}

      {full && (
        <p
          data-testid="events-cap"
          className="mt-3 rounded-[10px] bg-surface-metric px-3 py-2 text-[13px] leading-normal text-ink-2"
        >
          {capMessage('events', IMPORTED_EVENT_LIMITS.maxStored)}
        </p>
      )}

      {items !== null && upcoming.length === 0 && (
        <p className="mt-3 text-[13px] leading-normal text-ink-2">{m.noUpcoming}</p>
      )}

      {upcoming.length > 0 && (
        <ul className="mt-3.5 flex flex-col gap-2.5" aria-label={m.upcomingEvents}>
          {shown.map(item => (
            <EventCard
              key={item.key}
              item={item}
              home={location}
              homeWeather={weather}
              activities={prefs.activities}
              skinType={planning.skinType}
              mostSensitive={planning.mostSensitive}
              planDays={planDays}
              nowMs={nowMs}
              onUpgrade={displayTier === 'paid' ? undefined : onUpgrade}
              onSetPlace={setPlace}
              onSetActivity={setActivity}
              onRemove={event =>
                void remove([event.key], m.removedEvent(event.title || m.theEvent))
              }
            />
          ))}
        </ul>
      )}

      {(upcoming.length > FIRST_SHOWN || mayHoldImported) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {upcoming.length > FIRST_SHOWN ? (
            <button
              type="button"
              className="btn px-3 py-1.5 text-[12px]"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? m.showFewer : m.showAll(upcoming.length)}
            </button>
          ) : (
            <span />
          )}
          {!mayHoldImported ? null : confirmingClear ? (
            <span className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-[12px] text-ink-2">{m.removeAllConfirm}</span>
              <button
                type="button"
                className="btn px-3 py-1.5 text-[12px] text-danger"
                onClick={() => {
                  setConfirmingClear(false)
                  void removeImported()
                }}
              >
                {m.remove}
              </button>
              <button
                type="button"
                className="btn px-3 py-1.5 text-[12px]"
                onClick={() => setConfirmingClear(false)}
              >
                {m.keep}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-ghost px-3 py-1.5 text-[12px] text-ink-3"
              disabled={busy}
              onClick={() => setConfirmingClear(true)}
            >
              {m.removeImported}
            </button>
          )}
          {confirmingClear && keptSources.length > 0 && (
            <p className="w-full text-right text-[12px] leading-normal text-ink-3">
              {m.keptStay(listInWords(keptSources))}
            </p>
          )}
        </div>
      )}

      {(googleCalendarEventsLaunched() || outlookCalendarEventsLaunched()) && (
        // One boundary, so the shared note below never shows before its panels.
        <Suspense fallback={null}>
          {googleCalendarEventsLaunched() && (
            <GoogleCalendarEvents
              uid={uid}
              home={location}
              activities={prefs.activities}
              items={items ?? []}
              upcomingCount={upcoming.filter(item => item.source === 'google').length}
              allLoaded={(items?.length ?? 0) < IMPORTED_EVENT_LIMITS.listLimit}
              nowMs={nowMs}
            />
          )}
          {outlookCalendarEventsLaunched() && (
            <OutlookCalendarEvents
              uid={uid}
              home={location}
              activities={prefs.activities}
              items={items ?? []}
              upcomingCount={upcoming.filter(item => item.source === 'outlook').length}
              allLoaded={(items?.length ?? 0) < IMPORTED_EVENT_LIMITS.listLimit}
              nowMs={nowMs}
            />
          )}
          {/* How both connections update, said once below them: each panel used to carry
              its own copy, so with both on it showed twice (REVIEW7 L7.2). */}
          <p
            className="mt-2.5 text-[11px] leading-normal text-ink-3"
            data-testid="calendar-refresh-note"
          >
            {m.refreshNote}
          </p>
        </Suspense>
      )}

      {eventSubscriptionsLaunched() && (
        <Suspense fallback={null}>
          <EventSubscriptions
            uid={uid}
            nowMs={nowMs}
            pro={displayTier === 'paid'}
            sharedLink={sharedLink}
            // One calm Pro mention: with heads-ups on too, the note below offers both.
            onUpgrade={eventHeadsUpsLaunched() ? undefined : onUpgrade}
          />
        </Suspense>
      )}

      {eventHeadsUpsLaunched() && (displayTier === 'paid' || onUpgrade) && (
        <p
          className="mt-3 rounded-[10px] bg-surface-metric px-3 py-2 text-[12px] leading-normal text-ink-2"
          data-testid="event-heads-up-note"
        >
          {displayTier === 'paid' ? (
            <>{m.proSendsHeadsUp(eventHeadsUpRule())}</>
          ) : (
            <>
              {eventSubscriptionsLaunched() ? m.proAddsLinked : m.withProHeadsUp}{' '}
              <button
                type="button"
                className="font-semibold text-accent underline underline-offset-2"
                onClick={onUpgrade}
              >
                {m.seePro}
              </button>
            </>
          )}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-normal text-ink-3">
        {googleCalendarEventsLaunched() || outlookCalendarEventsLaunched()
          ? m.keptDataLinked
          : m.keptData}
      </p>
    </section>
  )
}

/**
 * Where events come from, as switched on and in the plan: "from a calendar (.ics) file, a
 * calendar link, Google Calendar or Outlook". Calendar links are Pro's (REVIEW8 SEC L3).
 */
function eventSources(pro: boolean): string {
  const sources = [
    m.sourceFile,
    ...(eventSubscriptionsLaunched() && pro ? [m.sourceLink] : []),
    ...(googleCalendarEventsLaunched() ? [m.googleCalendar] : []),
    ...(outlookCalendarEventsLaunched() ? [m.outlook] : []),
  ]
  return m.fromSources(core.listOr(sources))
}
