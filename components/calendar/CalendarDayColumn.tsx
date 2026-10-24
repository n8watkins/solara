import clsx from 'clsx'
import {
  holdsScheduled,
  nowMarker,
  scheduledBlock,
  uvRowBg,
  windowBlock,
  type Axis,
  type CalendarDayPlan,
  ROW_H,
} from '@/lib/calendar-grid'
import type { ChipVariant } from '@/lib/calendar-layout'
import type { UnitFormatters } from '@/lib/units'
import CalendarScheduledBlock from './CalendarScheduledBlock'
import CalendarWindowChip from './CalendarWindowChip'
import type { WindowSelection } from './useWindowSheet'

/**
 * One day of the week grid: UV-tinted hour rows, a lane per activity (clipped to the
 * column so nothing spills into the next day) and, today, the faded past and the
 * now line.
 */
export default function CalendarDayColumn({
  plan: { day, lanes },
  axis,
  hours,
  variant,
  fmt,
  nowFrac,
  todayNowHour,
  selectedKey,
  openEventId,
  chipRef,
  onToggleWindow,
  onOpenScheduled,
}: {
  plan: CalendarDayPlan
  axis: Axis
  /** The axis hour lines (see axisHours). */
  hours: number[]
  variant: ChipVariant
  fmt: UnitFormatters
  /** Fractional "now" in the forecast zone. */
  nowFrac: number
  /** The earliest start offered today. */
  todayNowHour: number
  selectedKey: string | undefined
  openEventId: string | null
  chipRef: (key: string) => (el: HTMLButtonElement | null) => void
  onToggleWindow: (selection: WindowSelection) => void
  onOpenScheduled: (eventId: string) => void
}) {
  const uvByHour = new Map(day.hourly.map(h => [h.hour, h.uv]))
  const now = day.isToday ? nowMarker(nowFrac, axis) : null
  return (
    <div
      data-testid="calendar-day-column"
      data-date={day.dateStr}
      className={clsx(
        'relative min-w-0 border-l border-line',
        // Decorative tint behind today's column; no text sits on it.
        day.isToday && 'bg-[rgba(249,115,22,0.06)]',
      )}
    >
      {/* UV tint and hour lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 inset-y-(--axis-pad) dark:opacity-75"
      >
        {hours.slice(0, -1).map((h, hi) => (
          <div
            key={h}
            className="absolute inset-x-0 h-(--row-h) border-t border-line"
            style={{ top: hi * ROW_H, background: uvRowBg(uvByHour.get(h)) }}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 border-t border-line" />
      </div>

      {/* Activity lanes, clipped to the column */}
      <div
        className="absolute inset-x-0 inset-y-(--axis-pad) grid gap-x-(--lane-gap) overflow-hidden px-(--lane-gap)"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, lanes.length)}, minmax(0, 1fr))` }}
      >
        {lanes.map(({ act, color, windows, scheduled }) => (
          <div key={act.id} className="relative min-w-0">
            {windows.map((win, wi) => {
              const block = windowBlock(win.from, win.to, axis)
              if (!block) return null
              const key = `${day.dateStr}:${act.id}:${wi}`
              return (
                <CalendarWindowChip
                  key={key}
                  ref={chipRef(key)}
                  act={act}
                  win={win}
                  dayLabel={day.label}
                  block={block}
                  color={color}
                  soft={holdsScheduled(win, scheduled)}
                  selected={selectedKey === key}
                  variant={variant}
                  fmt={fmt}
                  startsNow={day.isToday && win.from === todayNowHour}
                  onToggle={() => onToggleWindow({ act, win, day, key })}
                />
              )
            })}
            {scheduled.map(({ item, span }) => {
              const block = scheduledBlock(span.from, span.to, axis)
              if (!block) return null
              return (
                <CalendarScheduledBlock
                  key={item.eventId}
                  act={act}
                  item={item}
                  span={span}
                  block={block}
                  color={color}
                  dayLabel={day.label}
                  variant={variant}
                  fmt={fmt}
                  expanded={openEventId === item.eventId}
                  onOpen={() => onOpenScheduled(item.eventId)}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Hours already gone today are faded: nothing there can still be planned, so
          the column's live part starts at the now line. */}
      {now && now.pastHeight !== null && (
        <div
          aria-hidden="true"
          data-testid="calendar-past"
          className="pointer-events-none absolute inset-x-0 top-0 bg-surface-card opacity-55"
          style={{ height: now.pastHeight }}
        />
      )}
      {now && now.lineTop !== null && (
        <div
          aria-hidden="true"
          data-testid="calendar-now"
          className="pointer-events-none absolute inset-x-0 z-3 h-0.5 bg-accent"
          style={{ top: now.lineTop }}
        >
          <div className="absolute -top-[3px] left-0 size-2 rounded-full bg-accent" />
        </div>
      )}
    </div>
  )
}
