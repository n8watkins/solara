import type { Ref } from 'react'
import clsx from 'clsx'
import type { SafeWindow } from '@/lib/calendar'
import type { Block } from '@/lib/calendar-grid'
import type { ChipVariant } from '@/lib/calendar-layout'
import type { UnitFormatters } from '@/lib/units'
import type { Activity } from '@/lib/types'

/** One line of chip text, cut with an ellipsis when it does not fit. */
const chipLine = 'block max-w-full truncate leading-[13px]'
/** The chip's title line. */
export const chipTitle = `${chipLine} text-[11px]`
/** A time line under the chip title. */
export const chipTime = `${chipLine} text-[10.5px] font-medium tabular-nums`

/** Shared by window chips and scheduled blocks: hover brightening and a focus ring. */
export const chipBase =
  'absolute inset-x-0 m-0 flex flex-col overflow-hidden border-none transition-[filter,box-shadow] duration-[120ms] hover:brightness-112 focus-visible:outline-2'

/**
 * A lower-UV window in its activity's lane. A window that holds a scheduled
 * activity (`soft`) recedes to a tint, so the commitment inside it reads first.
 */
export default function CalendarWindowChip({
  ref,
  act,
  win,
  dayLabel,
  block,
  color,
  soft,
  selected,
  variant,
  fmt,
  startsNow,
  onToggle,
}: {
  ref: Ref<HTMLButtonElement>
  act: Activity
  win: SafeWindow
  dayLabel: string
  block: Block
  color: string
  soft: boolean
  selected: boolean
  variant: ChipVariant
  fmt: UnitFormatters
  /** A window under way, trimmed to start now: its start reads "now" (short and exact). */
  startsNow: boolean
  onToggle: () => void
}) {
  const full = variant === 'full'
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(
        chipBase,
        'justify-start gap-px focus-visible:-outline-offset-3',
        full ? 'items-start px-1.5 py-1 text-left' : 'items-center px-px py-1 text-center',
        soft ? 'text-ink focus-visible:outline-accent' : 'text-white focus-visible:outline-white',
        !block.cutTop && 'rounded-t-md',
        !block.cutBottom && 'rounded-b-md',
        selected ? 'z-2' : 'z-1',
      )}
      data-testid="calendar-chip"
      data-soft={soft || undefined}
      data-from={win.from}
      data-to={win.to}
      aria-haspopup="dialog"
      aria-expanded={selected}
      title={`${act.name} · ${fmt.time(win.from)}–${fmt.time(win.to)}`}
      onClick={onToggle}
      style={{
        top: block.top,
        height: block.height,
        background: soft ? `${color}2e` : color,
        boxShadow: soft
          ? `inset 0 0 0 1px ${color}${selected ? '' : '99'}`
          : selected
            ? `inset 0 0 0 2px rgba(255,255,255,0.95), 0 0 0 1px ${color}`
            : 'inset 0 0 0 1px rgba(255,255,255,0.14)',
      }}
    >
      {/* A receded window's label would sit under the scheduled block; the block and
          the accessible name say it all. */}
      {!soft && (
        <ChipLabel
          act={act}
          win={win}
          variant={variant}
          lines={block.lines}
          fmt={fmt}
          startsNow={startsNow}
        />
      )}
      {/* The visible label is abbreviated, so the accessible name is this full
          description instead. */}
      <span data-sr-only className="sr-only">
        {`${act.name}, ${dayLabel}, ${fmt.time(win.from)} – ${fmt.time(win.to)}, peak UV ${win.peakUV.toFixed(1)}`}
      </span>
    </button>
  )
}

function ChipLabel({
  act,
  win,
  variant,
  lines,
  fmt,
  startsNow,
}: {
  act: Activity
  win: SafeWindow
  variant: ChipVariant
  lines: number
  fmt: UnitFormatters
  startsNow: boolean
}) {
  if (variant === 'full') {
    return (
      <>
        <span aria-hidden="true" className={`${chipTitle} font-[650]`}>
          {act.icon} {act.name}
        </span>
        {lines >= 2 && (
          <span aria-hidden="true" className={chipTime}>
            {startsNow ? 'now' : fmt.time(win.from)} – {fmt.time(win.to)}
          </span>
        )}
      </>
    )
  }

  const label = variant === 'compact' ? fmt.compactHour : fmt.time
  return (
    <>
      <span aria-hidden="true" className="block max-w-full truncate text-[12px] leading-[14px]">
        {act.icon}
      </span>
      {lines >= 2 && (
        <span aria-hidden="true" className={chipTime}>
          {startsNow ? 'now' : label(win.from)}
        </span>
      )}
      {lines >= 3 && (
        <span aria-hidden="true" className={chipTime}>
          {label(win.to)}
        </span>
      )}
    </>
  )
}
