'use client'
// Events already in Outlook, in the Events section (docs/integrations/OUTLOOK.md, ROADMAP
// item 23): turn it on, sign in to Microsoft in a popup, and Solara reads the person's
// upcoming events with `Calendars.ReadBasic`, in this browser, and shows the UV at the
// ones with a place. Loaded on demand by EventsSection only when the feature is switched
// on (outlookCalendarEventsLaunched), so neither first load grows; the sign-in code
// (lib/microsoft-auth.ts) comes with it.
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { newOutlookCalendarLink, OUTLOOK_EVENT_LIMITS } from '@solara/core/event-import'
import { calendarsText, syncedText } from '@/lib/calendar-events'
import { firestoreEventsStore, geocodingLookups, type ImportedEvent } from '@/lib/events'
import {
  EventsStoreContext,
  OutlookCalendarApiContext,
  OutlookLinkStoreContext,
} from '@/lib/events-context'
import {
  MICROSOFT_PERSONAL_CONSENT_URL,
  MICROSOFT_WORK_APPS_URL,
  OutlookBusyError,
  disconnectOutlook,
  firestoreOutlookLinkStore,
  outlookAuthProblem,
  outlookCalendarApi,
  outlookCalendarChoices,
  outlookRefreshDue,
  outlookSyncSummary,
  refreshOutlookEvents,
  removeOutlookEvents,
  type OutlookCalendarChoice,
  type OutlookCalendarLink,
} from '@/lib/outlook-events'
import { eventSubscriptionsLaunched } from '@/lib/plans'
import type { Activity, Location } from '@/lib/types'

interface Props {
  uid: string
  home: Location
  activities: readonly Activity[]
  /** The events the section has loaded (the soonest upcoming ones). */
  items: readonly ImportedEvent[]
  /** Upcoming events from Outlook among them. */
  upcomingCount: number
  /** Whether `items` holds every upcoming event (fewer than the section loads at most). */
  allLoaded: boolean
  /** Now, as the dashboard shows it. */
  nowMs: number
}

type Busy = 'connect' | 'refresh' | 'choose' | 'disconnect' | null

interface Status {
  text: string
  error?: boolean
  /** Adds where to remove Solara's permission at Microsoft (after a disconnect). */
  consentLinks?: boolean
}

const SMALL_BUTTON = 'btn px-2.5 py-[5px] text-[12px]'
const LINK = 'font-semibold text-accent underline underline-offset-2'
const MAX = OUTLOOK_EVENT_LIMITS.maxCalendars

/** What to tell the person when Microsoft or Graph refused, or null to say nothing. */
function problemText(error: unknown, connected: boolean): string | null {
  if (error instanceof OutlookBusyError) return 'Outlook is busy. Try again in a few minutes.'
  const auth = outlookAuthProblem(error)
  if (!auth) return 'Could not reach Outlook. Try again.'
  switch (auth.reason) {
    case 'popup_closed':
      return null
    case 'popup_failed_to_open':
      return 'Your browser blocked the Microsoft sign-in window. Allow pop-ups for Solara, then try again.'
    case 'admin_approval':
      return `Your organization needs to approve Solara before it can read your work calendar. Ask your IT team${
        eventSubscriptionsLaunched() ? ', or link the calendar under Linked calendars instead' : ''
      }.`
    default:
      return connected
        ? 'Outlook needs your permission again. Press Refresh to continue.'
        : 'Outlook was not connected. Try again.'
  }
}

export default function OutlookCalendarEvents({
  uid,
  home,
  activities,
  items,
  upcomingCount,
  allLoaded,
  nowMs,
}: Props) {
  const api = useContext(OutlookCalendarApiContext) ?? outlookCalendarApi
  const linkStore = useContext(OutlookLinkStoreContext) ?? firestoreOutlookLinkStore
  const events = useContext(EventsStoreContext) ?? firestoreEventsStore
  const id = useId()
  const [link, setLink] = useState<OutlookCalendarLink | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [choosing, setChoosing] = useState<{
    options: OutlookCalendarChoice[]
    picked: string[]
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Counted on the server when the section loaded only the soonest events (REVIEW6 L5).
  const [counted, setCounted] = useState<number | null>(null)
  const busyRef = useRef<Busy>(null)
  const linkRef = useRef<OutlookCalendarLink | null | undefined>(undefined)

  useEffect(
    () =>
      linkStore.subscribe(
        uid,
        next => {
          linkRef.current = next
          setLink(next)
          setLoadError(false)
        },
        () => setLoadError(true),
      ),
    [linkStore, uid],
  )

  // The Microsoft token belongs to this account's session only: it is forgotten when the
  // panel goes (sign-out, an account switch, or leaving the dashboard).
  useEffect(() => () => api.forget(), [api, uid])

  /**
   * Reads the chosen calendars and stores their events; returns what it did, or nothing
   * when the connection was removed or changed meanwhile, on another device (REVIEW6 L4).
   */
  async function sync(current: OutlookCalendarLink, interactive: boolean): Promise<Status | null> {
    const token = await api.requestToken({ interactive })
    const outcome = await refreshOutlookEvents({
      uid,
      link: current,
      api,
      token,
      home,
      activities,
      nowMs: Date.now(),
      store: events,
      linkStore,
      lookups: geocodingLookups,
      onProgress: setProgress,
    })
    return outcome && { text: outlookSyncSummary(outcome) }
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<Status | null>) {
    if (busyRef.current) return
    busyRef.current = kind
    setBusy(kind)
    setStatus(null)
    try {
      const next = await action()
      if (next) setStatus(next)
    } catch (error) {
      const text = problemText(error, !!linkRef.current)
      setStatus(text ? { text, error: true } : null)
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
      if (busyRef.current || !api.hasToken()) return
      if (!outlookRefreshDue(link, Date.now())) return
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

  // Outlook events with no connection: a disconnect (here or on another device) whose
  // removal stopped halfway. They are removed, as the disconnect meant.
  const orphaned = link === null && items.some(item => item.source === 'outlook')
  useEffect(() => {
    if (!orphaned || busyRef.current) return
    void run('disconnect', async () => {
      // Only when the server agrees the connection is gone (not a cache that has not
      // heard of it yet).
      if (!(await linkStore.read(uid))) await removeOutlookEvents(uid, events)
      return null
    })
  }, [orphaned, uid, events, linkStore])

  // With more upcoming events than the section loads, the panel's count comes from an
  // aggregate count of every stored Outlook event, after each change, at the section's now.
  const syncedAt = link?.syncedAt
  useEffect(() => {
    if (allLoaded || !syncedAt || busy) return
    let current = true
    events.countUpcoming(uid, 'outlook', nowMs).then(
      count => current && setCounted(count),
      () => {},
    )
    return () => {
      current = false
    }
  }, [allLoaded, syncedAt, busy, upcomingCount, uid, events, nowMs])
  const shownCount = allLoaded ? upcomingCount : Math.max(upcomingCount, counted ?? 0)

  function connect() {
    void run('connect', async () => {
      // The popup opens on this click, before anything else is awaited.
      await api.requestToken({ interactive: true })
      const next = newOutlookCalendarLink(new Date().toISOString())
      await linkStore.save(uid, next)
      return sync(next, false)
    })
  }

  function chooseCalendars(current: OutlookCalendarLink) {
    void run('choose', async () => {
      // The same permission lists calendars, so this asks for nothing new.
      const token = await api.requestToken({ interactive: true })
      const options = outlookCalendarChoices(await api.listCalendars(token))
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

  function saveChoice(current: OutlookCalendarLink) {
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
      await disconnectOutlook({ uid, linkStore, store: events, api })
      return { text: 'Disconnected Outlook and removed its events.', consentLinks: true }
    })
  }

  function askToDisconnect() {
    setStatus(null)
    setChoosing(null)
    setConfirming(true)
  }

  const headingId = `${id}-heading`
  const hintId = `${id}-hint`
  const working = busy !== null
  const alert = status?.error || (!status && !progress && loadError)
  return (
    <div
      className="mt-4 border-t-[0.5px] border-line pt-3.5"
      data-testid="outlook-calendar-events"
      aria-labelledby={headingId}
      role="group"
    >
      <h3 id={headingId} className="text-[14px] font-semibold text-ink">
        Outlook
      </h3>

      {link === null && (
        <>
          <p id={hintId} className="mt-1 text-[12px] leading-normal text-ink-3">
            See the UV at events already in your Outlook.com or Microsoft 365 calendar. Solara reads
            the next {OUTLOOK_EVENT_LIMITS.windowDays} days in this browser, with permission to read
            basic event details only, and keeps only events with an address or a place picked in
            Outlook, or that match one of your activities. Only an address&rsquo;s town is searched
            to find the place.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-2.5 px-3.5 py-2 text-[13px] max-sm:w-full max-sm:justify-center"
            aria-describedby={hintId}
            disabled={working}
            onClick={connect}
          >
            <CalendarDays size={15} aria-hidden="true" />
            {busy === 'connect' ? 'Connecting…' : 'Show my Outlook events'}
          </button>
        </>
      )}

      {link && (
        <div
          className="@container mt-2.5 rounded-[12px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5"
          data-testid="outlook-calendar-link"
        >
          <div className="flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <CalendarDays size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[13px] leading-snug font-semibold break-words text-ink">
                    {calendarsText(link.calendars)}
                  </p>
                  {/* In a narrow card, a quiet text button here, so the three actions never
                      leave Disconnect alone on a second row (as for Google, REVIEW6 L7). */}
                  {!confirming && (
                    <button
                      type="button"
                      className="-my-1 -mr-1.5 shrink-0 rounded-[8px] px-1.5 py-1 text-[12px] font-semibold text-ink-3 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 @lg:hidden"
                      disabled={working}
                      onClick={askToDisconnect}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] leading-normal break-words text-ink-3">
                  {syncedText(link.syncedAt, nowMs)}
                  {link.syncedAt &&
                    ` · ${shownCount.toLocaleString('en-US')} upcoming ${shownCount === 1 ? 'event' : 'events'}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 @lg:justify-end">
              {confirming ? (
                <>
                  <span className="mr-auto text-[12px] text-ink-2">
                    Remove its events from Solara?
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
                    className={`${SMALL_BUTTON} hidden @lg:inline-flex`}
                    disabled={working}
                    onClick={askToDisconnect}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>

          {choosing && (
            <fieldset className="mt-2.5 border-t-[0.5px] border-line pt-2.5">
              <legend className="sr-only">Calendars to show events from</legend>
              <p className="text-[12px] leading-normal text-ink-2">
                Show events from up to {MAX} of your calendars.
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
          role={alert ? 'alert' : 'status'}
          data-testid="outlook-calendar-status"
          className={`mt-2.5 rounded-[10px] px-3 py-2 text-[13px] leading-normal ${
            alert ? 'bg-danger/8 text-danger' : 'bg-brand/8 text-ink-2'
          }`}
        >
          {progress ??
            status?.text ??
            'Could not load your Outlook settings. Check your connection.'}
          {!progress && status?.consentLinks && (
            <>
              {' '}
              Solara kept no Microsoft token. To also remove the permission you gave it, use{' '}
              <a
                className={LINK}
                href={MICROSOFT_PERSONAL_CONSENT_URL}
                target="_blank"
                rel="noreferrer"
              >
                your Microsoft account
              </a>{' '}
              (Outlook.com) or{' '}
              <a className={LINK} href={MICROSOFT_WORK_APPS_URL} target="_blank" rel="noreferrer">
                My Apps
              </a>{' '}
              (work or school).
            </>
          )}
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
