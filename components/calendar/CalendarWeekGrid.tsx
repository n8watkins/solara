import type { CSSProperties, UIEvent } from 'react'
import clsx from 'clsx'
import { dayOfMonth } from '@/lib/time'
import {
  AXIS_PAD,
  axisBodyHeight,
  axisHours,
  HEADER_H,
  ROW_H,
  type Axis,
  type CalendarDayPlan,
} from '@/lib/calendar-grid'
import { chipVariant, LANE_GAP, type ColumnLayout } from '@/lib/calendar-layout'
import type { UnitFormatters } from '@/lib/units'
import CalendarDayColumn from './CalendarDayColumn'
import type { WindowSelection } from './useWindowSheet'

/**
 * The week grid: sticky day headers and hour gutter around one column per day. It
 * scrolls both ways and snaps horizontally to whole days.
 */
export default function CalendarWeekGrid({
  plans,
  axis,
  columns: { colW, gutterW, laneW },
  gridRef,
  onScroll,
  fmt,
  nowFrac,
  todayNowHour,
  selectedKey,
  openEventId,
  chipRef,
  onToggleWindow,
  onOpenScheduled,
}: {
  plans: CalendarDayPlan[]
  axis: Axis
  columns: ColumnLayout
  /** Callback ref for the scroll box (see useGridViewport). */
  gridRef: (el: HTMLDivElement | null) => void
  onScroll: (e: UIEvent<HTMLDivElement>) => void
  fmt: UnitFormatters
  nowFrac: number
  todayNowHour: number
  selectedKey: string | undefined
  openEventId: string | null
  chipRef: (key: string) => (el: HTMLButtonElement | null) => void
  onToggleWindow: (selection: WindowSelection) => void
  onOpenScheduled: (eventId: string) => void
}) {
  const hours = axisHours(axis)
  const variant = chipVariant(laneW)
  // Geometry shared with the columns, as variables their utilities read.
  const geometry = {
    '--row-h': `${ROW_H}px`,
    '--axis-pad': `${AXIS_PAD}px`,
    '--lane-gap': `${LANE_GAP}px`,
    gridTemplateColumns: `${gutterW}px repeat(${plans.length}, minmax(${colW}px, 1fr))`,
    gridTemplateRows: `${HEADER_H}px ${axisBodyHeight(axis)}px`,
  } as CSSProperties

  return (
    <div
      ref={gridRef}
      data-testid="calendar-grid"
      onScroll={onScroll}
      className="max-h-[760px] snap-x snap-mandatory overflow-auto overscroll-x-contain rounded-xl border-[0.5px] border-line-strong bg-surface-card"
      style={{ scrollPaddingLeft: gutterW }}
    >
      <div className="grid" style={geometry}>
        <div
          data-testid="calendar-corner"
          className="sticky top-0 left-0 z-4 border-b border-line bg-surface-card"
        />

        {plans.map(({ day }) => (
          <div
            key={day.dateStr}
            data-testid="calendar-day-header"
            className={clsx(
              'sticky top-0 z-3 flex min-w-0 snap-start flex-col items-center justify-center gap-[3px] border-b border-l border-line',
              day.isToday ? 'bg-accent-soft' : 'bg-surface-card',
            )}
          >
            <span
              className={clsx(
                'text-[11px] leading-none font-semibold tracking-[0.06em] uppercase',
                day.isToday ? 'text-accent' : 'text-ink-3',
              )}
            >
              {day.shortLabel}
            </span>
            <span
              className={clsx(
                'text-[17px] leading-none font-[650] tabular-nums',
                day.isToday ? 'text-accent' : 'text-ink',
              )}
            >
              {dayOfMonth(day.dateStr)}
            </span>
          </div>
        ))}

        {/* Hour gutter */}
        <div aria-hidden="true" className="sticky left-0 z-2 bg-surface-card">
          {hours.map((h, i) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-ink-3 tabular-nums"
              style={{ top: AXIS_PAD + i * ROW_H }}
            >
              {fmt.hour(h)}
            </span>
          ))}
        </div>

        {plans.map(plan => (
          <CalendarDayColumn
            key={plan.day.dateStr}
            plan={plan}
            axis={axis}
            hours={hours}
            variant={variant}
            fmt={fmt}
            nowFrac={nowFrac}
            todayNowHour={todayNowHour}
            selectedKey={selectedKey}
            openEventId={openEventId}
            chipRef={chipRef}
            onToggleWindow={onToggleWindow}
            onOpenScheduled={onOpenScheduled}
          />
        ))}
      </div>
    </div>
  )
}
