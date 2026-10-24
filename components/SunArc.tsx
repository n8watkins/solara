'use client'
import { useId, useRef } from 'react'
import type { HourlyForecast } from '@/lib/types'
import { uvColor } from '@/lib/weather'
import { useElementWidth } from '@/hooks/useElementWidth'
import { hourSlots } from '@/lib/uv-strip'
import { FocusMarker, NowSun, PeakMarker } from './dashboard/SunArcMarkers'
import {
  SUN_ARC_BASELINE_Y as BASELINE_Y,
  SUN_ARC_HEIGHT as HEIGHT,
  hourAtOffset,
  peakLabelAnchor,
  sunArcGeometry,
} from '@/lib/sun-arc'

interface Props {
  hourly: HourlyForecast[]
  /** Fractional current hour on today (drives the sun marker); null on other days. */
  nowHour: number | null
  /** The hour currently being inspected (shared with the UV strip below). */
  focused: HourlyForecast | null
  /** Select an hour by tapping/dragging the arc; drives the shared focus. */
  onSelectHour: (h: HourlyForecast) => void
}

/**
 * Decorative sun path over the hourly UV strip. Pointer users can tap or drag it
 * to scrub hours; it is hidden from assistive technology because the strip's
 * bars below are the accessible, keyboard-operable version of the same control.
 */
export default function SunArc({ hourly, nowHour, focused, onSelectHour }: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const dragging = useRef(false)

  const ids = useId()
  const lineId = `${ids}-line`
  const clipId = `${ids}-known`
  const glowId = `${ids}-glow`
  // Positions follow the strip's slots, which include hours with no UV data. The
  // SVG is drawn in real pixels at the strip's width (it renders inside the
  // strip's column, see UVTimeline `above`), so each hour sits over its bar.
  const slots = hourSlots(hourly)
  const first = hourly[0]
  if (!first) return null
  const {
    x0,
    x1,
    path,
    tForIndex,
    pointAt,
    indexOfHour,
    indexForTime,
    pointForHour,
    gaps,
    knownSpans,
  } = sunArcGeometry(slots, width)

  const peak = hourly.reduce((best, h) => (h.uv > best.uv ? h : best), first)
  const hasPeak = peak.uv >= 0.5
  const peakPoint = pointForHour(peak.hour) ?? pointAt(0.5)
  const nowIndex = nowHour !== null ? indexForTime(nowHour) : null
  const nowPoint = nowIndex !== null ? pointAt(tForIndex(nowIndex)) : null
  const focusedPoint = focused ? pointForHour(focused.hour) : null
  // Hide the peak callout while the focus marker sits on the peak.
  const showPeakLabel = hasPeak && focused?.hour !== peak.hour

  // Map a pointer x (client px) to the nearest bar's hour, then report it upward.
  function selectFromClientX(svg: SVGSVGElement, clientX: number) {
    const rect = svg.getBoundingClientRect()
    const h = hourAtOffset(slots, clientX - rect.left, rect.width)
    if (h) onSelectHour(h)
  }

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="mb-1.5 h-[124px] overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(251,191,36,0.13),rgba(249,115,22,0.05))]"
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block cursor-pointer touch-pan-x touch-pan-y"
          focusable="false"
          onPointerDown={e => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            selectFromClientX(e.currentTarget, e.clientX)
          }}
          onPointerMove={e => {
            if (dragging.current) selectFromClientX(e.currentTarget, e.clientX)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        >
          <defs>
            {/* userSpaceOnUse: gradient offsets follow the bars, so each stretch of
                the line takes the color of the hour beneath it. */}
            <linearGradient
              id={lineId}
              gradientUnits="userSpaceOnUse"
              x1={x0}
              x2={x1}
              y1="0"
              y2="0"
            >
              {slots.map((slot, i) =>
                slot.data ? (
                  <stop
                    key={slot.hour}
                    offset={`${tForIndex(i) * 100}%`}
                    stopColor={uvColor(slot.data.uv)}
                  />
                ) : null,
              )}
            </linearGradient>
            {/* The colored line is drawn only where both ends of a stretch have
                data; across a gap only the faint dashed guide remains. */}
            <clipPath id={clipId}>
              {knownSpans.map(([from, to]) => (
                <rect key={from} x={from} y="0" width={to - from} height={HEIGHT} />
              ))}
            </clipPath>
            <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(251,191,36,0.48)" />
              <stop offset="100%" stopColor="rgba(251,191,36,0)" />
            </radialGradient>
          </defs>

          {/* Border drawn in the SVG (not CSS) so the measured width is the full
              column width and hours stay centered over their bars. */}
          <rect
            x="0.25"
            y="0.25"
            width={width - 0.5}
            height={HEIGHT - 0.5}
            rx="11.75"
            fill="none"
            stroke="rgba(251,191,36,0.24)"
            strokeWidth="0.5"
          />
          <line
            x1={x0}
            y1={BASELINE_Y}
            x2={x1}
            y2={BASELINE_Y}
            stroke="rgba(156,163,175,0.24)"
            strokeWidth="1"
          />
          {gaps.length > 0 && (
            <path
              d={path}
              fill="none"
              stroke="rgba(156,163,175,0.55)"
              strokeWidth="1.5"
              strokeDasharray="3 5"
            />
          )}
          <g clipPath={`url(#${clipId})`}>
            <path
              d={path}
              fill="none"
              stroke={`url(#${lineId})`}
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.34)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeDasharray="4 7"
            />
          </g>
          {gaps.map(([from, to]) => {
            const mid = pointAt(tForIndex((indexOfHour(from) + indexOfHour(to)) / 2))
            // The dashed guide and bars already mark the gap; drop its label rather
            // than let it collide with the peak callout.
            if (showPeakLabel && Math.abs(mid.x - peakPoint.x) < 72) return null
            return (
              <text
                key={from}
                x={mid.x}
                y={mid.y - 10}
                textAnchor="middle"
                fill="var(--text-3)"
                fontSize="10.5"
                fontWeight="600"
              >
                No data
              </text>
            )
          })}

          {hasPeak && (
            <PeakMarker
              point={peakPoint}
              uv={peak.uv}
              hour={peak.hour}
              label={showPeakLabel}
              anchor={peakLabelAnchor(peakPoint.x, width)}
            />
          )}
          {nowPoint && <NowSun point={nowPoint} glowId={glowId} />}
          {focusedPoint && <FocusMarker point={focusedPoint} />}
        </svg>
      )}
    </div>
  )
}
