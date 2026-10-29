'use client'
// "Shared with Solara": what someone shared to the installed app (the manifest's
// share_target; lib/share-target.ts, lib/shared-item.ts), at the top of the dashboard.
// A calendar file goes through the same import as "Import .ics" (lib/events.ts), after a
// preview and the person's confirmation; a calendar link opens the linked calendars form
// prefilled, on Pro. Loaded only when the app opens with `?shared=<id>`
// (components/Dashboard.tsx), so no first load carries it.
import { use, useEffect, useId, useState, type ReactNode } from 'react'
import { Share2 } from 'lucide-react'
import type { IcsParseResult } from '@solara/core/event-import'
import {
  firestoreEventsStore,
  geocodingLookups,
  importIcsFile,
  importSummary,
  readErrorMessage,
  readIcsFile,
  type ImportedEvent,
} from '@/lib/events'
import { EventsStoreContext } from '@/lib/events-context'
import { eventSubscriptionsLaunched } from '@/lib/plans'
import {
  PREVIEW_COUNT,
  clearSharedItem,
  dropSharedParam,
  loadSharedItem,
  previewEvents,
  previewHeadline,
  refusalMessage,
  sharedLinkKind,
  type SharedItem as Shared,
} from '@/lib/shared-item'
import { firebaseEnabled } from '@/lib/firebase'
import { resolveTimeZone } from '@/lib/time'
import { useUnits } from '@/lib/use-units'
import type { Location, UserPreferences } from '@/lib/types'
import GoogleSignInButton from '../GoogleSignInButton'

interface Props {
  /** The share id from `?shared=`. */
  id: string
  /** The signed-in account, or null for a guest. */
  uid: string | null
  prefs: UserPreferences
  /** Whether the account has Pro (linked calendars are part of it). */
  pro: boolean
  /** Opens the Pro plans; absent in an app store build. */
  onUpgrade?: () => void
  /** Puts a shared calendar link in the linked calendars form. */
  onLink: (link: string) => void
  /** The card is done (imported, dismissed or nothing to show). */
  onClose: () => void
}

type Preview =
  | { state: 'reading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; result: IcsParseResult }

type Run =
  | { state: 'idle' }
  | { state: 'busy'; progress: string }
  | { state: 'done'; text: string }
  | { state: 'failed'; text: string }

const BUTTON = 'btn justify-center px-3.5 py-2 text-[13px]'

export default function SharedItem({ id, uid, prefs, pro, onUpgrade, onLink, onClose }: Props) {
  const headingId = useId()
  const fmt = useUnits()
  const store = use(EventsStoreContext) ?? firestoreEventsStore
  const [item, setItem] = useState<Shared | null>(null)
  const [preview, setPreview] = useState<Preview>({ state: 'reading' })
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [existing, setExisting] = useState<ImportedEvent[]>([])
  const [linked, setLinked] = useState(false)
  const home = prefs.location as Location

  useEffect(() => {
    let active = true
    void loadSharedItem(id, Date.now()).then(found => {
      if (active) setItem(found)
    })
    return () => {
      active = false
    }
  }, [id])

  // The preview reads the file in the parser's worker, in the person's own zone.
  const file = item?.kind === 'file' ? item.file : null
  useEffect(() => {
    if (!file) return
    let active = true
    readIcsFile(file, { home, nowMs: Date.now() }).then(
      result => active && setPreview({ state: 'ready', result }),
      error => active && setPreview({ state: 'error', message: readErrorMessage(error) }),
    )
    return () => {
      active = false
    }
  }, [file, home])

  // Events already stored, so the import keeps places set by hand (as EventsSection does).
  useEffect(() => {
    if (!uid || !file) return
    return store.subscribe(
      uid,
      Date.now(),
      snapshot => setExisting(snapshot.items),
      () => {},
    )
  }, [store, uid, file])

  async function close() {
    dropSharedParam()
    await clearSharedItem()
    onClose()
  }

  async function importShared() {
    if (!uid || !file) return
    setRun({ state: 'busy', progress: 'Reading the file…' })
    const outcome = await importIcsFile(file, {
      home,
      activities: prefs.activities,
      existing,
      nowMs: Date.now(),
      lookups: geocodingLookups,
      seriesEvents: seriesIds => store.seriesEvents(uid, seriesIds),
      save: records => store.save(uid, records),
      remove: keys => store.remove(uid, keys),
      onProgress: progress => setRun({ state: 'busy', progress }),
    })
    if (!outcome.ok) {
      // The file stays, so trying again needs nothing shared again.
      setRun({ state: 'failed', text: outcome.message })
      return
    }
    dropSharedParam()
    await clearSharedItem()
    setRun({ state: 'done', text: importSummary(outcome) })
  }

  function openLinkedCalendars(link: string) {
    onLink(link)
    setLinked(true)
    dropSharedParam()
    void clearSharedItem()
    // The form is in the Events section, prefilled; bring it into view.
    requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>('[data-testid="event-subscriptions"]')
      form?.scrollIntoView({ block: 'center' })
      form?.querySelector<HTMLInputElement>('input[type="url"]')?.focus({ preventScroll: true })
    })
  }

  const notNow = (label = 'Not now') => (
    <button type="button" className={BUTTON} onClick={() => void close()}>
      {label}
    </button>
  )

  return (
    <section
      className="card"
      aria-labelledby={headingId}
      aria-busy={item === null || undefined}
      data-testid="shared-item"
    >
      <div className="flex items-center gap-2">
        <Share2 size={16} aria-hidden="true" className="shrink-0 text-accent" />
        <h2 id={headingId} className="text-[16px] font-bold text-ink">
          Shared with Solara
        </h2>
      </div>
      {body()}
    </section>
  )

  function body() {
    if (item === null) return <Status>Reading what you shared…</Status>
    if (item.kind === 'none') {
      return (
        <>
          <Text>
            Nothing to import: what was shared has been imported already, or it waited more than 30
            minutes. Share it again to import it.
          </Text>
          <Actions>{notNow('Close')}</Actions>
        </>
      )
    }
    if (item.kind === 'refused') {
      return (
        <>
          <Status alert>{refusalMessage(item.reason)}</Status>
          <Actions>{notNow('Close')}</Actions>
        </>
      )
    }
    if (item.kind === 'link') return linkBody(item.link)
    return fileBody(item.name)
  }

  function fileBody(name: string) {
    if (preview.state === 'reading') return <Status>Reading {name}…</Status>
    if (preview.state === 'error') {
      return (
        <>
          <Status alert>{preview.message}</Status>
          <Actions>{notNow('Close')}</Actions>
        </>
      )
    }
    if (run.state === 'done') {
      return (
        <>
          <Status>{run.text}</Status>
          <Actions>
            <button type="button" className={`${BUTTON} btn-primary`} onClick={onClose}>
              Done
            </button>
          </Actions>
        </>
      )
    }
    const { events } = preview.result
    const shown = previewEvents(
      preview.result,
      Date.now(),
      resolveTimeZone(home.timezone),
      fmt.time,
    )
    const more = events.length - PREVIEW_COUNT
    return (
      <>
        <Text strong>{previewHeadline(name, events.length)}</Text>
        {shown.length > 0 && (
          <ul
            className="mt-2 flex flex-col gap-1.5 rounded-[12px] bg-surface-metric px-3 py-2.5"
            aria-label={`Events in ${name}`}
          >
            {shown.map((event, index) => (
              <li key={index} className="min-w-0 text-[13px] leading-snug">
                <span className="block font-semibold break-words text-ink">{event.title}</span>{' '}
                <span className="block text-ink-3">{event.when}</span>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <p className="mt-1.5 text-[12px] text-ink-3">
            And {more} more {more === 1 ? 'event' : 'events'}.
          </p>
        )}
        {events.length === 0 ? (
          <Actions>{notNow('Close')}</Actions>
        ) : !uid ? (
          <>
            <Text>
              Sign in to keep them: Solara keeps events with your account. The file waits here for
              30 minutes{firebaseEnabled ? '' : ' (signing in is not available on this site)'}.
            </Text>
            <Actions>
              <GoogleSignInButton label="Sign in with Google" />
              {notNow()}
            </Actions>
          </>
        ) : (
          <>
            {run.state === 'busy' && <Status>{run.progress}</Status>}
            {run.state === 'failed' && <Status alert>{run.text}</Status>}
            <Actions>
              <button
                type="button"
                className={`${BUTTON} btn-primary`}
                disabled={run.state === 'busy'}
                onClick={() => void importShared()}
              >
                {run.state === 'failed'
                  ? 'Try again'
                  : `Import ${events.length} ${events.length === 1 ? 'event' : 'events'}`}
              </button>
              {run.state !== 'busy' && notNow()}
            </Actions>
          </>
        )}
      </>
    )
  }

  function linkBody(link: string) {
    const kind = sharedLinkKind(link)
    const host = new URL(link).host
    const canLink = !!uid && pro && eventSubscriptionsLaunched()
    if (kind === 'page' || (kind === 'unknown' && !canLink)) {
      return (
        <>
          <Text>
            That is a link to a web page ({host}), not a calendar. On the event’s page, use “Add to
            calendar” or “Export” to download an .ics file, then share the file to Solara.
          </Text>
          <Actions>{notNow('Close')}</Actions>
        </>
      )
    }
    if (!eventSubscriptionsLaunched()) {
      return (
        <>
          <Text>
            Solara cannot link calendars yet. Download the calendar from {host} as an .ics file and
            share the file instead.
          </Text>
          <Actions>{notNow('Close')}</Actions>
        </>
      )
    }
    if (canLink) {
      return linked ? (
        <>
          <Text>
            The calendar link from {host} is in Linked calendars below, with the steps for its
            provider. Check it, then press Link calendar.
          </Text>
          <Actions>{notNow('Close')}</Actions>
        </>
      ) : (
        <>
          <Text>A calendar link from {host}. Link it, and Solara keeps its events current.</Text>
          <Actions>
            <button
              type="button"
              className={`${BUTTON} btn-primary`}
              onClick={() => openLinkedCalendars(link)}
            >
              Add this calendar
            </button>
            {notNow()}
          </Actions>
        </>
      )
    }
    if (!uid) {
      return (
        <>
          <Text>
            A calendar link from {host}. Linked calendars keep a calendar’s events current and are
            part of Pro, so sign in first. The link waits here for 30 minutes.
          </Text>
          <Actions>
            <GoogleSignInButton label="Sign in with Google" />
            {notNow()}
          </Actions>
        </>
      )
    }
    return (
      <>
        <Text>
          A calendar link from {host}. Linked calendars, which keep a calendar’s events current, are
          part of Pro.
        </Text>
        <Actions>
          {onUpgrade && (
            <button type="button" className={`${BUTTON} btn-primary`} onClick={onUpgrade}>
              See Pro
            </button>
          )}
          {notNow()}
        </Actions>
      </>
    )
  }
}

function Text({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <p
      className={`mt-2 text-[13px] leading-normal break-words ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}
    >
      {children}
    </p>
  )
}

function Status({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? 'alert' : 'status'}
      data-testid="shared-item-status"
      className={`mt-2.5 rounded-[10px] px-3 py-2 text-[13px] leading-normal ${
        alert ? 'bg-danger/8 text-danger' : 'bg-brand/8 text-ink-2'
      }`}
    >
      {children}
    </p>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
}
