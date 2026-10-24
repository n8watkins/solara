'use client'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ScheduledActivity } from '@solara/core'
import { CalendarAuthError } from '@/lib/gcal'
import { durationHours, scheduledSpan, startOptions } from '@/lib/scheduled'
import { useScheduled } from '@/lib/scheduled-context'
import { useUnits } from '@/lib/use-units'
import type { Activity, SafeActivityWindow } from '@/lib/types'
import BottomSheet, { SheetActions, SheetClose, sheetAction } from './BottomSheet'
import ChangeTimePanel, { sheetPanel } from './scheduled/ChangeTimePanel'
import ScheduledPill from './scheduled/ScheduledPill'
import ScheduledTile from './scheduled/ScheduledTile'

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

const bodyText = 'text-[13px] leading-[1.5] text-ink-2'

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
    <BottomSheet ref={sheetRef} labelledBy={titleId} testId="scheduled-sheet">
      <div className="flex items-start gap-3">
        <ScheduledTile color={color}>{icon}</ScheduledTile>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-ink">
            <span id={titleId}>{name}</span>
            <ScheduledPill />
          </p>
          <p className="mt-0.5 mb-0 text-[13px] text-ink-2 tabular-nums">
            {dayLabel} · {fmt.time(span.from)} – {fmt.time(span.to)}
          </p>
        </div>
        <SheetClose onClose={onClose} disabled={busy} />
      </div>

      {mode === 'view' && (
        <>
          <p className={`${bodyText} mt-3`}>
            This activity is on your Google Calendar. Changes you make here update the event there,
            and changes made in Google Calendar show here.
          </p>
          <SheetActions>
            <a
              className={`${sheetAction} btn-primary col-span-full`}
              href={item.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Calendar ↗
            </a>
            <button
              type="button"
              className={sheetAction}
              onClick={() => {
                setError(null)
                setMode('change')
              }}
            >
              Change time
            </button>
            <button
              type="button"
              className={`${sheetAction} text-danger`}
              aria-label="Remove from calendar"
              onClick={() => {
                setError(null)
                setMode('remove')
              }}
            >
              Remove
            </button>
          </SheetActions>
        </>
      )}

      {mode === 'change' && (
        <ChangeTimePanel
          id={`${titleId}-start`}
          today={dayLabel === 'Today'}
          options={options}
          hours={hours}
          picked={picked}
          current={current}
          busy={busy}
          onPick={setChoice}
          onCancel={() => setMode('view')}
          onSave={saveTime}
        />
      )}

      {mode === 'remove' && (
        <div className={sheetPanel}>
          <p className={bodyText}>
            Remove this event from your Google Calendar? It is deleted there too.
          </p>
          <SheetActions>
            <button
              type="button"
              className={sheetAction}
              disabled={busy}
              onClick={() => setMode('view')}
            >
              Keep it
            </button>
            <button
              type="button"
              className="btn min-h-10 justify-center border-none bg-danger text-white hover:brightness-110 dark:text-[#1a1208]"
              disabled={busy}
              onClick={removeEvent}
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </SheetActions>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 mb-0 text-[12px] leading-[1.45] text-danger">
          {error}
        </p>
      )}
    </BottomSheet>
  )
}
