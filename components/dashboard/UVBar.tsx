import type { Ref } from 'react'
import type { HourlyForecast } from '@/lib/types'
import { formatUV, uvBand, uvLabel } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import VisuallyHidden from '../VisuallyHidden'
import { UV_BG } from './uv-classes'

// One hour on the UV strip. Bars grow to fill the strip and never get narrower
// than UV_BAR_MIN_WIDTH (42px, lib/uv-strip.ts); below that the strip scrolls.
// Bars snap to the middle, and the end bars to their edge, so the strip can rest
// at either end (where it sits before sunrise and after sunset).
const SLOT =
  'flex flex-[1_0_42px] min-w-[42px] flex-col items-center justify-center gap-[3px] py-3 px-0 rounded-[10px] snap-center first:snap-start last:snap-end'
/** The current hour's ring, outside the bar. */
const NOW_RING = 'shadow-[0_0_0_2px_var(--bg-card),0_0_0_3.5px_var(--text)]'

/** An hour with UV data: a pressable bar in its band's color. */
export function UVBar({
  hour,
  isNow,
  selected,
  onSelect,
  ref,
}: {
  hour: HourlyForecast
  isNow: boolean
  selected: boolean
  onSelect: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  const fmt = useUnits()
  return (
    <button
      data-hour={hour.hour}
      ref={ref}
      onClick={onSelect}
      aria-pressed={selected}
      className={`uv-bar ${SLOT} cursor-pointer border-2 text-uv-ink transition-[border-color] duration-[120ms] ${UV_BG[uvBand(hour.uv)]} ${
        selected ? 'border-ink' : 'border-transparent'
      } ${isNow && !selected ? NOW_RING : ''}`}
    >
      {/* Read as "UV 6.0, High, at 10am, current hour": hidden words fill in
          around the visible number and hour so the name contains both. */}
      <span className="text-[13px] font-bold leading-none">
        <VisuallyHidden>UV </VisuallyHidden>
        {formatUV(hour.uv, { compact: true })}
        <VisuallyHidden>, {uvLabel(hour.uv)}, at </VisuallyHidden>
      </span>
      <span className="text-[10px] leading-none">
        {fmt.hour(hour.hour)}
        {isNow && <VisuallyHidden>, current hour</VisuallyHidden>}
      </span>
    </button>
  )
}

/** An hour the forecast has no UV for: a non-interactive gap marker. */
export function UVGap({
  hour,
  isNow,
  ref,
}: {
  hour: number
  isNow: boolean
  ref?: Ref<HTMLDivElement>
}) {
  const fmt = useUnits()
  return (
    <div
      data-hour={hour}
      data-missing="true"
      ref={ref}
      className={`${SLOT} border-[1.5px] border-dashed border-line-strong text-ink-3 ${
        isNow ? NOW_RING : ''
      }`}
    >
      <span className="text-[13px] font-bold leading-none">
        <span aria-hidden="true">–</span>
        <VisuallyHidden>No UV data at </VisuallyHidden>
      </span>
      <span className="text-[10px] leading-none">
        {fmt.hour(hour)}
        {isNow && <VisuallyHidden>, current hour</VisuallyHidden>}
      </span>
    </div>
  )
}
