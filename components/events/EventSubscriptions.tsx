'use client'
// Linked calendars in the Events section (docs/integrations/EVENTS.md, phase 2): paste an
// https or webcal link, and the server keeps its events current. Loaded on demand by
// EventsSection only when the feature is switched on (eventSubscriptionsLaunched).
import { useContext, useEffect, useId, useState, type FormEvent } from 'react'
import { CalendarSync, Link2, RefreshCw } from 'lucide-react'
import {
  REFRESH_HOURS,
  SUBSCRIPTION_CAP,
  linkProblem,
  serverSubscriptionsStore,
  subscriptionView,
  type SubscriptionSummary,
} from '@/lib/event-subscriptions'
import { SubscriptionsStoreContext } from '@/lib/events-context'
import { EVENT_HEADS_UP } from '@solara/core/event-import'

interface Props {
  uid: string
  nowMs: number
  /** Pro accounts get heads-ups before high-UV events. */
  pro: boolean
  /** Opens the plans dialog (Free). */
  onUpgrade?: () => void
}

type Busy = { kind: 'add' } | { kind: 'refresh' | 'remove'; id: string } | null

const SMALL_BUTTON = 'btn px-2.5 py-[5px] text-[12px]'

export default function EventSubscriptions({ uid, nowMs, pro, onUpgrade }: Props) {
  const store = useContext(SubscriptionsStoreContext) ?? serverSubscriptionsStore
  const id = useId()
  const [items, setItems] = useState<SubscriptionSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

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
    void run({ kind: 'add' }, async () => {
      const added = await store.add(uid, url)
      setUrl('')
      return added.error
        ? `Linked ${added.label || added.host}, but its events could not be read yet.`
        : `Linked ${added.label || added.host}: ${added.eventCount} upcoming ${added.eventCount === 1 ? 'event' : 'events'}.`
    })
  }

  const inputId = `${id}-url`
  const hintId = `${id}-hint`
  return (
    <div className="mt-4 border-t-[0.5px] border-line pt-3.5" data-testid="event-subscriptions">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Linked calendars</h3>
        {items !== null && (
          <span className="text-[12px] text-ink-3 tabular-nums">
            {count} of {SUBSCRIPTION_CAP}
          </span>
        )}
      </div>
      <p id={hintId} className="mt-1 text-[12px] leading-normal text-ink-3">
        Paste a calendar link (https:// or webcal://), such as a club or race calendar, and Solara
        keeps its events current, checking every {REFRESH_HOURS} hours.
      </p>

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
          aria-describedby={hintId}
          className="min-w-0 flex-1 py-2 text-[13px]"
          value={url}
          disabled={full || busy !== null}
          onChange={event => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary shrink-0 justify-center px-3.5 py-2 text-[13px]"
          disabled={full || busy !== null || !url.trim()}
        >
          <Link2 size={15} aria-hidden="true" />
          {busy?.kind === 'add' ? 'Checking the link…' : 'Link calendar'}
        </button>
      </form>
      {full && (
        <p className="mt-2 text-[12px] leading-normal text-ink-2">
          You have linked {SUBSCRIPTION_CAP} calendars, the most an account can keep. Remove one to
          link another.
        </p>
      )}

      {(status || loadError) && (
        <p
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
                className="rounded-[12px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5"
              >
                <div className="flex items-start gap-2.5">
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
                    {view.problem && (
                      <p className="mt-1 text-[12px] leading-normal text-danger">{view.problem}</p>
                    )}
                    {view.refused && (
                      <p className="mt-1 text-[12px] leading-normal text-ink-2">{view.refused}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
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
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-2.5 text-[11px] leading-normal text-ink-3">
        The link stays private on Solara&rsquo;s server; only its site is shown here. Removing a
        calendar removes its events.
      </p>
      <p
        className="mt-2 rounded-[10px] bg-surface-metric px-3 py-2 text-[12px] leading-normal text-ink-2"
        data-testid="event-heads-up-note"
      >
        {pro ? (
          <>
            Pro sends a heads-up about {EVENT_HEADS_UP.leadHours} hours before an event with UV{' '}
            {EVENT_HEADS_UP.uv} or higher, to the devices you turned alerts on for. Change it in
            Settings.
          </>
        ) : (
          <>
            With Pro, get a heads-up a few hours before an event with high UV.{' '}
            {onUpgrade && (
              <button
                type="button"
                className="font-semibold text-accent underline underline-offset-2"
                onClick={onUpgrade}
              >
                See Pro
              </button>
            )}
          </>
        )}
      </p>
    </div>
  )
}
