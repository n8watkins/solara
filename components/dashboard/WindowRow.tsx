import { formatUV } from '@solara/core'
import type { SafeActivityWindow } from '@/lib/types'
import { useUnits } from '@/lib/use-units'
import VisuallyHidden from '../VisuallyHidden'
import { windowLabelText, type WindowLabel } from '@solara/core/recommendation'
import { timeRange } from '@/lib/time'
import m from '@/messages/activities'

const ACTION = 'btn px-[9px] py-[5px] text-[11px]'

/** One lower-UV window on an activity card, with Share and calendar actions. */
export default function WindowRow({
  win,
  isBest,
  cloudNote,
  onShare,
  calendarHref,
  onSchedule,
}: {
  win: SafeActivityWindow
  isBest: boolean
  cloudNote?: boolean
  onShare: () => void
  calendarHref?: string
  /** Adds this window to Google Calendar as a scheduled activity (replaces the link). */
  onSchedule?: () => void
}) {
  const fmt = useUnits()
  const range = timeRange(fmt.time(win.from), fmt.time(win.to))
  const calendarLabel = (
    <>
      {m.cal}
      <VisuallyHidden>{m.calAdd(range)}</VisuallyHidden>
    </>
  )
  return (
    <div
      data-testid="activity-window"
      data-from={win.from}
      data-to={win.to}
      className={`flex items-center gap-[9px] rounded-[10px] px-2.5 py-2 ${
        isBest
          ? 'border-[1.5px] border-accent bg-brand/8'
          : 'border-[0.5px] border-line-strong bg-surface-metric'
      }`}
    >
      <div className="min-w-0 flex-1">
        {/* The time range never breaks inside itself; BEST wraps below it as a unit
            when a narrow card has no room beside it. */}
        <div className="flex flex-wrap items-baseline gap-x-[7px]">
          <span className="text-[13px] font-bold whitespace-nowrap text-ink">{range}</span>
          {isBest && (
            <span className="text-[10px] font-[750] tracking-[0.05em] whitespace-nowrap text-accent uppercase">
              {m.best}
            </span>
          )}
        </div>
        {/* Wraps after the dot rather than cutting the peak off ("Atardecer · UV má..." at
            320 px in Spanish); each part stays whole. */}
        <span className="block text-[11px] text-ink-3">
          <span className="whitespace-nowrap">{windowLabelText(win.label as WindowLabel)}</span>
          {'\u00a0· '}
          <span className="whitespace-nowrap">{m.peakUv(formatUV(win.peakUV))}</span>
          {cloudNote ? m.ifCloudsHold : ''}
        </span>
      </div>
      <div className="flex shrink-0 gap-[5px]">
        <button className={ACTION} onClick={onShare} aria-label={m.shareNamed(range)}>
          {m.share}
        </button>
        {onSchedule ? (
          <button className={ACTION} onClick={onSchedule}>
            {calendarLabel}
          </button>
        ) : (
          calendarHref && (
            <a
              className={`${ACTION} no-underline`}
              href={calendarHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {calendarLabel}
            </a>
          )
        )}
      </div>
    </div>
  )
}
