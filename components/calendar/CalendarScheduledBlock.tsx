import clsx from 'clsx'
import type { Block } from '@/lib/calendar-grid'
import type { ChipVariant } from '@/lib/calendar-layout'
import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import type { UnitFormatters } from '@/lib/units'
import type { Activity } from '@/lib/types'
import { chipBase, chipTime, chipTitle } from './CalendarWindowChip'

/** A scheduled activity in its lane: solid, with a check, above the suggested windows. */
export default function CalendarScheduledBlock({
  act,
  item,
  span,
  block,
  color,
  dayLabel,
  variant,
  fmt,
  expanded,
  onOpen,
}: {
  act: Activity
  item: ScheduledActivity
  span: ScheduledSpan
  block: Block
  color: string
  dayLabel: string
  variant: ChipVariant
  fmt: UnitFormatters
  expanded: boolean
  onOpen: () => void
}) {
  const full = variant === 'full'
  return (
    <button
      type="button"
      className={clsx(
        chipBase,
        'z-2 rounded-md text-white focus-visible:outline-accent focus-visible:outline-offset-1',
        full ? 'items-start px-1.5 py-0.5 text-left' : 'items-center px-px py-0.5 text-center',
        block.lines >= 2 ? 'justify-start' : 'justify-center',
      )}
      data-testid="calendar-scheduled"
      data-event-id={item.eventId}
      data-from={span.from}
      data-to={span.to}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={`Scheduled: ${act.name} · ${fmt.time(span.from)}–${fmt.time(span.to)}`}
      onClick={onOpen}
      style={{
        top: block.top,
        height: block.height,
        background: color,
        boxShadow: expanded
          ? `inset 0 0 0 2px #fff, 0 0 0 2px ${color}, 0 3px 8px rgba(0,0,0,0.3)`
          : 'inset 0 0 0 1.5px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.28)',
      }}
    >
      <span aria-hidden="true" className={`${chipTitle} font-[750]`}>
        {full ? '✓ Scheduled' : '✓'}
      </span>
      {block.lines >= 2 && (
        <span aria-hidden="true" className={chipTime}>
          {full ? `${fmt.time(span.from)} – ${fmt.time(span.to)}` : fmt.compactHour(span.from)}
        </span>
      )}
      <span data-sr-only className="sr-only">
        {`Scheduled: ${act.name}, ${dayLabel}, ${fmt.time(span.from)} – ${fmt.time(span.to)}`}
      </span>
    </button>
  )
}
