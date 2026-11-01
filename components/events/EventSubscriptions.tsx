'use client'
// Linked calendars in the Events section (docs/integrations/EVENTS.md, phase 2): paste an
// https or webcal link, and the server keeps its events current. Loaded on demand by
// EventsSection only when the feature is switched on (eventSubscriptionsLaunched).
// "Add a calendar from..." (ROADMAP item 24) is loaded only when opened.
// Linked calendars are Pro-only (REVIEW8 SEC L3): another plan sees what they do and a
// way to Pro instead of the form, and an account that is no longer Pro keeps its list to
// remove links (the server has paused them).
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  CalendarSync,
  CircleCheck,
  ChevronDown,
  Link2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import {
  calendarLinkHint,
  calendarLinkRefused,
  recogniseCalendarLink,
} from '@solara/core/event-import'
import {
  REFRESH_HOURS,
  SUBSCRIPTION_CAP,
  linkProblem,
  serverSubscriptionsStore,
  subscriptionTitle,
  subscriptionView,
  type SubscriptionSummary,
} from '@/lib/event-subscriptions'
import { SubscriptionsStoreContext } from '@/lib/events-context'
import { googleCalendarEventsLaunched } from '@/lib/plans'

const AddCalendarGuide = lazy(() => import('./AddCalendarGuide'))

interface Props {
  uid: string
  nowMs: number
  /** Whether the account has Pro, which linked calendars are part of. */
  pro: boolean
  /**
   * Opens the plans dialog from the offer a non-Pro account sees. Absent when the Events
   * section makes one Pro offer for linked calendars and heads-ups together below.
   */
  onUpgrade?: () => void
  /**
   * A calendar link shared to the app (components/events/SharedItem.tsx): it fills the
   * link field and opens "Add a calendar from..." at the link's provider.
   */
  sharedLink?: string | null
}

type Busy = { kind: 'add' } | { kind: 'refresh' | 'remove'; id: string } | null

const SMALL_BUTTON = 'btn px-2.5 py-[5px] text-[12px]'

export default function EventSubscriptions({
  uid,
  nowMs,
  pro,
  onUpgrade,
  sharedLink = null,
}: Props) {
  const store = useContext(SubscriptionsStoreContext) ?? serverSubscriptionsStore
  const id = useId()
  const [items, setItems] = useState<SubscriptionSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  // `refused`: the link field's own warning, repeated as the status after "Link calendar";
  // while it shows, the hint under the field steps aside so the sentence appears once.
  const [status, setStatus] = useState<{
    text: string
    error?: boolean
    refused?: boolean
  } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  // A newly shared link replaces what is in the field and opens the helper.
  const [appliedLink, setAppliedLink] = useState<string | null>(null)
  if (sharedLink && sharedLink !== appliedLink && pro) {
    setAppliedLink(sharedLink)
    setUrl(sharedLink)
    setGuideOpen(true)
    setStatus(null)
  }
  // What the pasted link looks like, worked out here and never sent or logged.
  const recognised = useMemo(() => recogniseCalendarLink(url), [url])
  const linkHint = calendarLinkHint(recognised)
  const refusalShown = status?.refused === true
  const shownHint = refusalShown ? null : linkHint

  useEffect(
    () =>
      store.subscribe(
        uid,
        next => {
          setItems(next)
          setLoadError(false)
        },
        () => setLoadError(true),
      ),
    [store, uid],
  )

  const count = items?.length ?? 0
  const full = count >= SUBSCRIPTION_CAP

  async function run(next: Busy, action: () => Promise<string>) {
    setBusy(next)
    setStatus(null)
    try {
      setStatus({ text: await action() })
    } catch (error) {
      setStatus({
        text: error instanceof Error && error.message ? error.message : 'Something went wrong.',
        error: true,
      })
    } finally {
      setBusy(null)
    }
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const problem = linkProblem(url)
    if (problem) {
      setStatus({ text: problem, error: true })
      return
    }
    // A provider's website or HTML page can never be a calendar: say so without a fetch.
    if (calendarLinkRefused(recognised) && linkHint) {
      setStatus({ text: linkHint.text, error: true, refused: true })
      return
    }
    void run({ kind: 'add' }, async () => {
      const added = await store.add(uid, url)
      setUrl('')
      const title = subscriptionTitle(added)
      return added.error
        ? `Linked ${title}, but its events could not be read yet.`
        : `Linked ${title}: ${added.eventCount} upcoming ${added.eventCount === 1 ? 'event' : 'events'}.`
    })
  }

  const inputId = `${id}-url`
  const hintId = `${id}-hint`
  const guideId = `${id}-guide`
  const linkHintId = `${id}-link-hint`
  const statusId = `${id}-status`
  return (
    <div className="mt-4 border-t-[0.5px] border-line pt-3.5" data-testid="event-subscriptions">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Linked calendars</h3>
        {!pro ? (
          <span className="text-[11px] font-bold tracking-[0.05em] whitespace-nowrap text-accent uppercase">
            Pro
          </span>
        ) : (
          items !== null && (
            <span className="text-[12px] text-ink-3 tabular-nums">
              {count} of {SUBSCRIPTION_CAP}
            </span>
          )
        )}
      </div>
      {!pro ? (
        <div data-testid="event-subscriptions-offer">
          <p className="mt-1 text-[12px] leading-normal text-ink-2">
            {count > 0
              ? 'Linked calendars are part of Pro, so yours have stopped refreshing. Their events stay until they end, or remove them below.'
              : `${onUpgrade ? 'With Pro, paste' : 'Paste'} a calendar link, such as a club or race calendar, and Solara keeps its events current, checking every ${REFRESH_HOURS} hours.`}
          </p>
          {onUpgrade && (
            <button type="button" className="btn mt-2 text-[12px]" onClick={onUpgrade}>
              See Pro
            </button>
          )}
        </div>
      ) : (
        <>
          <p id={hintId} className="mt-1 text-[12px] leading-normal text-ink-3">
            Paste a calendar link (https:// or webcal://), such as a club or race calendar, and
            Solara keeps its events current, checking every {REFRESH_HOURS} hours.
          </p>
          <button
            type="button"
            className="mt-1 inline-flex min-h-6 items-center gap-1 text-[12px] font-semibold text-accent underline-offset-2 hover:underline"
            aria-expanded={guideOpen}
            aria-controls={guideId}
            onClick={() => setGuideOpen(!guideOpen)}
          >
            Add a calendar from…
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform motion-reduce:transition-none ${guideOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <div id={guideId} hidden={!guideOpen}>
            {guideOpen && (
              <Suspense fallback={null}>
                <AddCalendarGuide
                  googleEvents={googleCalendarEventsLaunched()}
                  // A shared link opens the helper at its provider's steps.
                  initialProvider={appliedLink ? recogniseCalendarLink(appliedLink).provider : null}
                />
              </Suspense>
            )}
          </div>

          <form className="mt-2.5 flex gap-2 max-sm:flex-col" onSubmit={add} noValidate>
            <label htmlFor={inputId} className="sr-only">
              Calendar link
            </label>
            <input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://… or webcal://…"
              aria-describedby={`${hintId} ${refusalShown ? statusId : linkHintId}`}
              className="min-w-0 flex-1 py-2 text-[13px]"
              value={url}
              disabled={full || busy !== null}
              onChange={event => {
                setUrl(event.target.value)
                // A refusal was about the old link; the hint speaks for the new one.
                if (refusalShown) setStatus(null)
              }}
            />
            <button
              type="submit"
              // Disabled, it is an outline button: a faded filled one reads as active. A link
              // that cannot be a calendar keeps it clickable (it explains why) but not inviting.
              className={`btn shrink-0 justify-center px-3.5 py-2 text-[13px] ${
                full || busy !== null || !url.trim() || calendarLinkRefused(recognised)
                  ? ''
                  : 'btn-primary'
              }`}
              disabled={full || busy !== null || !url.trim()}
            >
              <Link2 size={15} aria-hidden="true" />
              {busy?.kind === 'add' ? 'Checking the link…' : 'Link calendar'}
            </button>
          </form>
          {/* Names the provider a pasted link comes from, or the mistake, as it is pasted. */}
          <p
            id={linkHintId}
            aria-live="polite"
            data-testid="calendar-link-hint"
            className={`flex gap-1.5 text-[12px] leading-normal ${
              shownHint ? 'mt-1.5' : 'hidden'
            } ${shownHint?.tone === 'warning' ? 'text-notice-ink' : 'text-ink-2'}`}
          >
            {shownHint?.tone === 'ok' && (
              <CircleCheck size={14} aria-hidden="true" className="mt-px shrink-0 text-success" />
            )}
            {shownHint?.tone === 'warning' && (
              <TriangleAlert size={14} aria-hidden="true" className="mt-px shrink-0" />
            )}
            {shownHint && <span>{shownHint.text}</span>}
          </p>
        </>
      )}
      {pro && full && (
        <p className="mt-2 text-[12px] leading-normal text-ink-2">
          You have linked {SUBSCRIPTION_CAP} calendars, the most an account can keep. Remove one to
          link another.
        </p>
      )}

      {(status || loadError) && (
        <p
          id={statusId}
          role={status?.error || (!status && loadError) ? 'alert' : 'status'}
          data-testid="event-subscriptions-status"
          className={`mt-2.5 rounded-[10px] px-3 py-2 text-[13px] leading-normal ${
            status?.error || (!status && loadError)
              ? 'bg-danger/8 text-danger'
              : 'bg-brand/8 text-ink-2'
          }`}
        >
          {status?.text ?? 'Could not load your linked calendars. Check your connection.'}
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Linked calendars">
          {items.map(item => {
            const view = subscriptionView(item, nowMs)
            const titleId = `${id}-${item.id}`
            const rowBusy = busy !== null
            return (
              <li
                key={item.id}
                aria-labelledby={titleId}
                data-testid="event-subscription"
                className="@container rounded-[12px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5"
              >
                {/* On a wide row the buttons sit beside the text; on a narrow one, below it. */}
                <div className="flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <CalendarSync
                      size={16}
                      className="mt-0.5 shrink-0 text-ink-3"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        id={titleId}
                        className="text-[13px] leading-snug font-semibold break-words text-ink"
                      >
                        {view.title}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-normal break-words text-ink-3">
                        {view.meta}
                      </p>
                      {/* Without Pro the offer above says why nothing refreshes, so a
                          row's own retry wording would contradict it. */}
                      {pro && view.problem && (
                        <p className="mt-1 text-[12px] leading-normal text-danger">
                          {view.problem}
                        </p>
                      )}
                      {view.refused && (
                        <p className="mt-1 text-[12px] leading-normal text-ink-2">{view.refused}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {confirming === item.id ? (
                      <>
                        <span className="mr-auto text-[12px] text-ink-2">
                          Remove it and its events?
                        </span>
                        <button
                          type="button"
                          className={`${SMALL_BUTTON} text-danger`}
                          disabled={rowBusy}
                          onClick={() => {
                            setConfirming(null)
                            void run({ kind: 'remove', id: item.id }, async () => {
                              await store.remove(uid, item.id)
                              return `Removed ${view.title} and its events.`
                            })
                          }}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        {pro && (
                          <button
                            type="button"
                            className={SMALL_BUTTON}
                            disabled={rowBusy}
                            aria-label={`Refresh ${view.title}`}
                            onClick={() =>
                              void run({ kind: 'refresh', id: item.id }, async () => {
                                const next = await store.refresh(uid, item.id)
                                return next.error
                                  ? `${view.title} could not be read.`
                                  : `Refreshed ${view.title}.`
                              })
                            }
                          >
                            <RefreshCw
                              size={12}
                              aria-hidden="true"
                              className={
                                busy?.kind === 'refresh' && busy.id === item.id
                                  ? 'motion-safe:animate-spin'
                                  : undefined
                              }
                            />
                            Refresh
                          </button>
                        )}
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          disabled={rowBusy}
                          aria-label={`Remove ${view.title}`}
                          onClick={() => setConfirming(item.id)}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {(pro || count > 0) && (
        <p className="mt-2.5 text-[11px] leading-normal text-ink-3">
          The link stays private on Solara&apos;s server; only its site is shown here. Removing a
          calendar removes its events.
        </p>
      )}
    </div>
  )
}
