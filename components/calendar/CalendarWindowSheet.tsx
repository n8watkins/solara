'use client'
import { timeRange } from '@/lib/time'
import { CalendarPlus, Cloud, Gauge, Lock, Share2 } from 'lucide-react'
import { cloudNote, confidenceNote, formatUV } from '@solara/core'
import { useState, type Ref } from 'react'
import { gcalWindowLink } from '@/lib/calendar'
import { durationText, windowSlot } from '@/lib/calendar-grid'
import { buildEventDescription } from '@/lib/gcal'
import { useScheduled } from '@/lib/scheduled-context'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import { useUnits } from '@/lib/use-units'
import type { UserPreferences } from '@/lib/types'
import type { StatusFlash } from '@/hooks/useStatusFlash'
import BottomSheet, { SheetActions, SheetClose, sheetAction } from '../BottomSheet'
import type { WindowSelection } from './useWindowSheet'
import m from '@/messages/calendar'
import dash from '@/messages/dashboard'
import activityText from '@/messages/activities'

/**
 * Details of a lower-UV window: its peak UV, and adding it to Google Calendar,
 * sharing it or editing the activity.
 */
export default function CalendarWindowSheet({
  ref,
  selection: { act, win, day },
  color,
  location,
  timeZone,
  canUseCalendar,
  status,
  onClose,
  onEdit,
}: {
  ref: Ref<HTMLDivElement>
  selection: WindowSelection
  color: string
  location: UserPreferences['location']
  /** The forecast location's zone. */
  timeZone: string
  /** The tier includes calendar actions. */
  canUseCalendar: boolean
  /** The calendar's status line, for the result of an action. */
  status: StatusFlash
  onClose: () => void
  /** Opens the activity editor; absent when activities cannot be changed here. */
  onEdit?: () => void
}) {
  const fmt = useUnits()
  const scheduled = useScheduled()
  const [adding, setAdding] = useState(false)

  /** Adds the window's recommended slot to Google Calendar; it then shows as Scheduled. */
  async function schedule() {
    const slot = windowSlot(act, win, day)
    if (!slot) return
    setAdding(true)
    try {
      await scheduled.schedule({
        activity: act,
        dateStr: day.dateStr,
        slot,
        description: buildEventDescription(slot, act, { peakUV: win.peakUV }),
        timeZone,
      })
      onClose()
      status.flash(dash.scheduledOnCalendar(act.name, fmt.time(slot.start)), 5000)
    } catch (error) {
      status.flash(
        // A RecordCapError (lib/record-cap.ts), matched by name to keep it out of this bundle.
        error instanceof Error && error.name === 'RecordCapError'
          ? error.message
          : dash.addToCalendarFailed,
        5000,
      )
    } finally {
      setAdding(false)
    }
  }

  async function share() {
    const payload = {
      activity: act,
      window: win,
      location,
      dateLabel: day.label,
      isoDate: day.dateStr,
    }
    const text = buildActivityShareText(payload, fmt.units.clock)
    const url = buildActivityShareUrl(payload, window.location.origin)
    let result: Awaited<ReturnType<typeof shareOrCopy>>
    try {
      result = await shareOrCopy(activityText.sunWindowTitle(act.name), text, url)
    } catch {
      status.clear()
      return
    }
    status.flash(
      result === 'shared' ? m.sharedWindow : result === 'copied' ? m.copiedShare : `${text} ${url}`,
      4500,
    )
  }

  return (
    <BottomSheet ref={ref} labelledBy="calendar-sheet-title" testId="calendar-sheet">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[18px]"
          style={{ background: color }}
        >
          {act.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p id="calendar-sheet-title" className="text-[15px] font-semibold text-ink">
            {act.name}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {day.label} · {timeRange(fmt.time(win.from), fmt.time(win.to))}
          </p>
        </div>
        <SheetClose onClose={onClose} />
      </div>
      <p className="mt-3 text-[13px] leading-[1.5] text-ink-2">
        {m.sheetPeakStart} <strong className="text-ink">{formatUV(win.peakUV)}</strong>
        {m.sheetScheduleStart}{' '}
        <strong className="text-ink">{durationText(act.durationMins)}</strong> {m.sheetScheduleEnd}
      </p>
      <ForecastNotes
        cloud={
          day.cloud
            ? `${cloudNote(day.cloud)}. ${act.cloudSensitive ? m.plansWithClouds : m.plansClearSky}`
            : null
        }
        confidence={confidenceNote(day.confidence)}
      />
      <SheetActions single={!onEdit}>
        {canUseCalendar && scheduled.enabled ? (
          <button
            type="button"
            className={`${sheetAction} btn-primary col-span-full`}
            disabled={adding}
            onClick={() => void schedule()}
          >
            {adding ? (
              m.addingToGoogle
            ) : (
              <>
                <CalendarPlus size={15} /> {m.addToGoogle}
              </>
            )}
          </button>
        ) : canUseCalendar ? (
          <a
            className={`${sheetAction} btn-primary col-span-full`}
            href={gcalWindowLink(act, win, day.dateStr, timeZone)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => status.flash(m.openedGoogle)}
          >
            <CalendarPlus size={15} /> {m.addToGoogle}
          </a>
        ) : (
          <span className="col-span-full inline-flex items-center justify-center gap-1.5 text-[12px] text-ink-3">
            <Lock size={13} /> {m.signInToAdd}
          </span>
        )}
        <button type="button" className={sheetAction} onClick={() => void share()}>
          <Share2 size={15} /> {m.share}
        </button>
        {onEdit && (
          <button type="button" className={sheetAction} onClick={onEdit}>
            {m.editActivity}
          </button>
        )}
      </SheetActions>
    </BottomSheet>
  )
}

/** How sure the day's forecast is, and how much its clouds lower UV. */
function ForecastNotes({ cloud, confidence }: { cloud: string | null; confidence: string | null }) {
  if (!cloud && !confidence) return null
  return (
    <ul data-testid="calendar-sheet-notes" className="mt-2.5 grid gap-1.5">
      {cloud && (
        <li className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-ink-2">
          <Cloud size={15} aria-hidden className="mt-px shrink-0 text-ink-3" />
          {cloud}
        </li>
      )}
      {confidence && (
        <li className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-ink-2">
          <Gauge size={15} aria-hidden className="mt-px shrink-0 text-ink-3" />
          {confidence}.
        </li>
      )}
    </ul>
  )
}
