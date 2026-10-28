'use client'
// Events already in Google Calendar, in the Events section (docs/integrations/EVENTS.md,
// phase 2b): turn it on, and Solara reads the person's upcoming events with a read-only
// scope, in this browser, and shows the UV at the ones with a place. Loaded on demand by
// EventsSection only when the feature is switched on (googleCalendarEventsLaunched).
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { newGoogleCalendarLink, GOOGLE_EVENT_LIMITS } from '@solara/core/event-import'
import { firestoreEventsStore, geocodingLookups, type ImportedEvent } from '@/lib/events'
import {
  EventsStoreContext,
  GoogleCalendarApiContext,
  GoogleLinkStoreContext,
} from '@/lib/events-context'
import {
  GOOGLE_CALENDAR_LIST_SCOPE,
  GOOGLE_EVENTS_SCOPE,
  authProblem,
  calendarChoices,
  calendarsText,
  disconnectGoogleCalendar,
  firestoreGoogleLinkStore,
  googleCalendarApi,
  refreshDue,
  refreshGoogleEvents,
  removeGoogleEvents,
  syncSummary,
  syncedText,
  type GoogleCalendarChoice,
  type GoogleCalendarLink,
} from '@/lib/google-events'
import type { Activity, Location } from '@/lib/types'

interface Props {
  uid: string
  home: Location
  activities: readonly Activity[]
  /** The events the section has loaded, to show each event once. */
  items: readonly ImportedEvent[]
  /** Upcoming events from Google Calendar among them. */
  upcomingCount: number
  /** Now, as the dashboard shows it. */
  nowMs: number
}

type Busy = 'connect' | 'refresh' | 'choose' | 'disconnect' | null

const SMALL_BUTTON = 'btn px-2.5 py-[5px] text-[12px]'
const MAX = GOOGLE_EVENT_LIMITS.maxCalendars

export default function GoogleCalendarEvents({
  uid,
  home,
  activities,
  items,
  upcomingCount,
  nowMs,
}: Props) {
  const api = useContext(GoogleCalendarApiContext) ?? googleCalendarApi
  const linkStore = useContext(GoogleLinkStoreContext) ?? firestoreGoogleLinkStore
  const events = useContext(EventsStoreContext) ?? firestoreEventsStore
  const id = useId()
  const [link, setLink] = useState<GoogleCalendarLink | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [choosing, setChoosing] = useState<{
    options: GoogleCalendarChoice[]
    picked: string[]
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // The loaded events change while a refresh saves; it reads the latest.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const busyRef = useRef<Busy>(null)

  useEffect(
    () =>
      linkStore.subscribe(
        uid,
        next => {
          setLink(next)
          setLoadError(false)
        },
        () => setLoadError(true),
      ),
    [linkStore, uid],
  )

  /**
   * Reads the chosen calendars and stores their events; returns what it did, or nothing
   * when the connection was removed or changed meanwhile, on another device (REVIEW6 L4).
   */
  async function sync(current: GoogleCalendarLink, interactive: boolean): Promise<string | null> {
    const token = await api.requestToken(GOOGLE_EVENTS_SCOPE, { interactive })
    const outcome = await refreshGoogleEvents({
      uid,
      link: current,
      api,
      token,
      home,
      activities,
      existing: itemsRef.current,
      nowMs: Date.now(),
      store: events,
      linkStore,
      lookups: geocodingLookups,
      onProgress: setProgress,
    })
    return outcome && syncSummary(outcome)
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<string | null>) {
    if (busyRef.current) return
    busyRef.current = kind
    setBusy(kind)
    setStatus(null)
    try {
      const text = await action()
      if (text) setStatus({ text })
    } catch (error) {
      const auth = authProblem(error)
      if (auth?.dismissed) setStatus(null)
      else if (auth) {
        setStatus({
          text: 'Google Calendar needs your permission again. Press Refresh to continue.',
          error: true,
        })
      } else setStatus({ text: 'Could not reach Google Calendar. Try again.', error: true })
    } finally {
      busyRef.current = null
      setBusy(null)
      setProgress(null)
    }
  }

  // While this session holds a token, events refresh by themselves every half hour.
  useEffect(() => {
    if (!link) return
    const check = () => {
      if (busyRef.current || !api.hasToken(GOOGLE_EVENTS_SCOPE)) return
      if (!refreshDue(link, Date.now())) return
      // A refresh by itself says nothing unless it fails.
      void run('refresh', async () => {
        await sync(link, false)
        return null
      })
    }
    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
    // `run` and `sync` read state through refs; the link is what changes the schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, api])

  // Google events with no connection: a disconnect (here or on another device) whose
  // removal stopped halfway. They are removed, as the disconnect meant.
  const orphaned = link === null && items.some(item => item.source === 'google')
  useEffect(() => {
    if (!orphaned || busyRef.current) return
    void run('disconnect', async () => {
      // Only when the server agrees the connection is gone (not a cache that has not
      // heard of it yet).
      if (!(await linkStore.read(uid))) await removeGoogleEvents(uid, events)
      return null
    })
  }, [orphaned, uid, events, linkStore])

  function connect() {
    void run('connect', async () => {
      await api.requestToken(GOOGLE_EVENTS_SCOPE, { interactive: true })
      const next = newGoogleCalendarLink(new Date().toISOString())
      await linkStore.save(uid, next)
      return sync(next, false)
    })
  }

  function chooseCalendars(current: GoogleCalendarLink) {
    void run('choose', async () => {
      const token = await api.requestToken(GOOGLE_CALENDAR_LIST_SCOPE, { interactive: true })
      const options = calendarChoices(await api.listCalendars(token))
      // Calendars chosen earlier that the list no longer has stay listed, so they can be
      // unticked.
      const known = new Set(options.map(o => o.id))
      setChoosing({
        options: [...options, ...current.calendars.filter(c => !known.has(c.id))],
        picked: current.calendars.map(c => c.id),
      })
      return null
    })
  }

  function saveChoice(current: GoogleCalendarLink) {
    if (!choosing) return
    const calendars = choosing.options.filter(o => choosing.picked.includes(o.id)).slice(0, MAX)
    if (!calendars.length) return
    void run('choose', async () => {
      setChoosing(null)
      // Disconnected on another device meanwhile: nothing to change.
      if (!(await linkStore.update(uid, { calendars }))) return null
      return sync({ ...current, calendars }, true)
    })
  }

  function disconnect() {
    setConfirming(false)
    void run('disconnect', async () => {
      const revoked = await disconnectGoogleCalendar({ uid, linkStore, store: events, api })
      return revoked
        ? 'Disconnected Google Calendar and removed its events.'
        : 'Removed the events from Google Calendar. To also end Solara’s access, remove Solara at myaccount.google.com/connections.'
    })
  }

  const headingId = `${id}-heading`
  const hintId = `${id}-hint`
  const working = busy !== null
  return (
    <div
      className="mt-4 border-t-[0.5px] border-line pt-3.5"
      data-testid="google-calendar-events"
      aria-labelledby={headingId}
      role="group"
    >
      <h3 id={headingId} className="text-[14px] font-semibold text-ink">
        Google Calendar
      </h3>

      {link === null && (
        <>
          <p id={hintId} className="mt-1 text-[12px] leading-normal text-ink-3">
            See the UV at events already in your Google Calendar. Solara reads the next{' '}
            {GOOGLE_EVENT_LIMITS.windowDays} days in this browser, with read-only access, and keeps
            only events with an address or that match one of your activities. Only an
            address&rsquo;s town is searched to find the place.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-2.5 px-3.5 py-2 text-[13px] max-sm:w-full max-sm:justify-center"
            aria-describedby={hintId}
            disabled={working}
            onClick={connect}
          >
            <CalendarDays size={15} aria-hidden="true" />
            {busy === 'connect' ? 'Connecting…' : 'Show my Google Calendar events'}
          </button>
        </>
      )}

      {link && (
        <div
          className="@container mt-2.5 rounded-[12px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5"
          data-testid="google-calendar-link"
        >
          <div className="flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <CalendarDays size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug font-semibold break-words text-ink">
                  {calendarsText(link.calendars)}
                </p>
                <p className="mt-0.5 text-[12px] leading-normal break-words text-ink-3">
                  {syncedText(link.syncedAt, nowMs)}
                  {link.syncedAt &&
                    ` · ${upcomingCount.toLocaleString('en-US')} upcoming ${upcomingCount === 1 ? 'event' : 'events'}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 @lg:justify-end">
              {confirming ? (
                <>
                  <span className="mr-auto text-[12px] text-ink-2">
                    Remove its events and Solara’s access?
                  </span>
                  <button
                    type="button"
                    className={`${SMALL_BUTTON} text-danger`}
                    disabled={working}
                    onClick={disconnect}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    onClick={() => setConfirming(false)}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={working}
                    onClick={() => void run('refresh', () => sync(link, true))}
                  >
                    <RefreshCw
                      size={12}
                      aria-hidden="true"
                      className={busy === 'refresh' ? 'motion-safe:animate-spin' : undefined}
                    />
                    Refresh
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={working}
                    aria-expanded={choosing !== null}
                    onClick={() => (choosing ? setChoosing(null) : chooseCalendars(link))}
                  >
                    Choose calendars
                  </button>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={working}
                    onClick={() => {
                      setStatus(null)
                      setConfirming(true)
                    }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
          {confirming && (
            <p className="mt-2 text-[12px] leading-normal text-ink-2">
              Google ends all of Solara’s calendar access at once, so Scheduled activities will ask
              to connect again.
            </p>
          )}

          {choosing && (
            <fieldset className="mt-2.5 border-t-[0.5px] border-line pt-2.5">
              <legend className="sr-only">Calendars to show events from</legend>
              <p className="text-[12px] leading-normal text-ink-2">
                Show events from up to {MAX} calendars.
              </p>
              <ul className="mt-1.5 flex flex-col">
                {choosing.options.map(option => {
                  const checked = choosing.picked.includes(option.id)
                  const full = !checked && choosing.picked.length >= MAX
                  return (
                    <li key={option.id}>
                      <label className="flex min-h-9 items-center gap-2.5 text-[13px] text-ink">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-accent"
                          checked={checked}
                          disabled={full || working}
                          onChange={() =>
                            setChoosing({
                              ...choosing,
                              picked: checked
                                ? choosing.picked.filter(p => p !== option.id)
                                : [...choosing.picked, option.id],
                            })
                          }
                        />
                        <span className="min-w-0 break-words">
                          {option.name || 'Your main calendar'}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn px-3 py-1.5 text-[12px] ${
                    working || choosing.picked.length === 0 ? '' : 'btn-primary'
                  }`}
                  disabled={working || choosing.picked.length === 0}
                  onClick={() => saveChoice(link)}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn px-3 py-1.5 text-[12px]"
                  onClick={() => setChoosing(null)}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}

      {(progress || status || loadError) && (
        <p
          role={status?.error || (!status && !progress && loadError) ? 'alert' : 'status'}
          data-testid="google-calendar-status"
          className={`mt-2.5 rounded-[10px] px-3 py-2 text-[13px] leading-normal ${
            status?.error || (!status && !progress && loadError)
              ? 'bg-danger/8 text-danger'
              : 'bg-brand/8 text-ink-2'
          }`}
        >
          {progress ??
            status?.text ??
            'Could not load your Google Calendar settings. Check your connection.'}
        </p>
      )}

      {link && (
        <p className="mt-2.5 text-[11px] leading-normal text-ink-3">
          Events update while Solara is open: by themselves for an hour after you connect or
          refresh, otherwise when you press Refresh.
        </p>
      )}
    </div>
  )
}
