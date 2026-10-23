'use client'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ScheduledActivity } from '@solara/core'
import { CalendarAuthError } from '@/lib/gcal'
import { durationHours, scheduledSpan, startOptions } from '@/lib/scheduled'
import { useScheduled } from '@/lib/scheduled-context'
import { useUnits } from '@/lib/use-units'
import type { Activity, SafeActivityWindow } from '@/lib/types'
import styles from './Scheduled.module.css'

interface Props {
  item: ScheduledActivity
  /** The activity it was scheduled for, when it still exists. */
  activity?: Activity
  color: string
  /** The forecast location's zone: times show and change in it. */
  timeZone: string
  /** "Today", "Tomorrow" or the date, for the item's day. */
  dayLabel: string
  /** That day's lower-UV windows for the activity (already trimmed to now on today). */
  windows: SafeActivityWindow[]
  /** Fractional "now" on today; -1 on other days. */
  nowHour: number
  onClose: () => void
  /** Called with a message after a change, for the parent's status line. */
  onDone?: (message: string) => void
}

type Mode = 'view' | 'change' | 'remove'

function problem(error: unknown): string {
  return error instanceof CalendarAuthError
    ? 'Google Calendar needs to be reconnected. Try again and allow access when Google asks.'
    : 'Could not reach Google Calendar. Nothing was changed; try again.'
}

/**
 * Details of a scheduled activity, as a bottom sheet: when it is, a link to the
 * event in Google Calendar, and changing its time or removing it.
 */
export default function ScheduledSheet({
  item,
  activity,
  color,
  timeZone,
  dayLabel,
  windows,
  nowHour,
  onClose,
  onDone,
}: Props) {
  const fmt = useUnits()
  const scheduled = useScheduled()
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const span = scheduledSpan(item, timeZone)
  const hours = durationHours(item)
  const options = startOptions(windows, hours, nowHour)
  const current = Math.round(span.from * 60) / 60
  const [choice, setChoice] = useState<number | null>(null)
  const picked = choice ?? (options.includes(current) ? current : (options[0] ?? null))
  const name = activity?.name ?? item.title
  const icon = activity?.icon ?? item.icon

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) onClose()
  })
  // Focus moves into the sheet and returns to whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheetRef.current?.focus()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  async function run(action: () => Promise<void>, message: string, close: boolean) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setMode('view')
      setChoice(null)
      onDone?.(message)
      if (close) onClose()
    } catch (err) {
      setError(problem(err))
    } finally {
      setBusy(false)
    }
  }

  function saveTime() {
    if (picked === null || picked === current) return
    void run(
      () =>
        scheduled.reschedule(item, {
          dateStr: span.date,
          start: picked,
          end: picked + hours,
          timeZone,
        }),
      `Moved ${name} to ${fmt.time(picked)}. Google Calendar is updated.`,
      false,
    )
  }

  function removeEvent() {
    void run(() => scheduled.remove(item), `Removed ${name} from your Google Calendar.`, true)
  }

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="scheduled-sheet"
      className={styles.sheet}
    >
      <div className={styles.head}>
        <span aria-hidden="true" className={styles.tile} style={{ background: color }}>
          {icon}
          <span className={styles.tileCheck}>✓</span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className={styles.title}>
            <span id={titleId}>{name}</span>
            <span className={styles.pill}>✓ Scheduled</span>
          </p>
          <p className={styles.when}>
            {dayLabel} · {fmt.time(span.from)} – {fmt.time(span.to)}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          style={{ padding: '4px 8px', minWidth: '32px', minHeight: '32px', fontSize: '14px' }}
        >
          ✕
        </button>
      </div>

      {mode === 'view' && (
        <>
          <p className={styles.body}>
            This activity is on your Google Calendar. Changes you make here update the event there,
            and changes made in Google Calendar show here.
          </p>
          <div className={styles.actions}>
            <a
              className={`btn btn-primary ${styles.action} ${styles.full}`}
              href={item.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Calendar ↗
            </a>
            <button
              type="button"
              className={`btn ${styles.action}`}
              onClick={() => {
                setError(null)
                setMode('change')
              }}
            >
              Change time
            </button>
            <button
              type="button"
              className={`btn ${styles.action} ${styles.danger}`}
              onClick={() => {
                setError(null)
                setMode('remove')
              }}
            >
              Remove from calendar
            </button>
          </div>
        </>
      )}

      {mode === 'change' && (
        <div className={styles.panel}>
          {options.length > 0 ? (
            <>
              <label className={styles.panelLabel} htmlFor={`${titleId}-start`}>
                New start time, within {dayLabel === 'Today' ? "today's" : "the day's"} lower-UV
                windows
              </label>
              <select
                id={`${titleId}-start`}
                className={styles.select}
                value={picked ?? ''}
                disabled={busy}
                onChange={e => setChoice(Number(e.target.value))}
              >
                {options.map(h => (
                  <option key={h} value={h}>
                    {fmt.time(h)} – {fmt.time(h + hours)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className={styles.note} style={{ margin: 0 }}>
              No other lower-UV start time is left on this day for this activity.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`btn ${styles.action}`}
              disabled={busy}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`btn btn-primary ${styles.action}`}
              disabled={busy || picked === null || picked === current}
              onClick={saveTime}
            >
              {busy ? 'Saving…' : 'Save time'}
            </button>
          </div>
        </div>
      )}

      {mode === 'remove' && (
        <div className={styles.panel}>
          <p className={styles.body} style={{ margin: 0 }}>
            Remove this event from your Google Calendar? It is deleted there too.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`btn ${styles.action}`}
              disabled={busy}
              onClick={() => setMode('view')}
            >
              Keep it
            </button>
            <button
              type="button"
              className={`btn ${styles.dangerFill}`}
              disabled={busy}
              onClick={removeEvent}
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
