'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { HourlyForecast } from '@/lib/types'
import { uvColor } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import { UV_BAR_GAP, hourSlots, missingRuns, uvBarCenter } from './UVTimeline'

interface Props {
  hourly: HourlyForecast[]
  /** Fractional current hour on today (drives the sun marker); null on other days. */
  nowHour: number | null
  /** The hour currently being inspected (shared with the UV strip below). */
  focused: HourlyForecast | null
  /** Select an hour by tapping/dragging the arc; drives the shared focus. */
  onSelectHour: (h: HourlyForecast) => void
}

// The SVG is drawn in real pixels (its viewBox tracks its measured width), so text
// and markers keep their shape at every width. It renders inside the UV strip's
// column (see UVTimeline `above`), so its width is the bars' width and every hour's
// x is the center of that hour's bar.
const HEIGHT = 124
const BASELINE_Y = 112
const APEX_Y = 34
// Quadratic bezier control point that puts the curve's apex (t = 0.5) at APEX_Y.
const CONTROL_Y = 2 * APEX_Y - BASELINE_Y

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/** Measure an element's content width and keep it current. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Decorative sun path over the hourly UV strip. Pointer users can tap or drag it
 * to scrub hours; it is hidden from assistive technology because the strip's
 * bars below are the accessible, keyboard-operable version of the same control.
 */
export default function SunArc({ hourly, nowHour, focused, onSelectHour }: Props) {
  const fmt = useUnits()
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const dragging = useRef(false)

  const ids = useId()
  const lineId = `${ids}-line`
  const clipId = `${ids}-known`
  // Positions follow the strip's slots, which include hours with no UV data.
  const slots = hourSlots(hourly)
  const count = slots.length
  const firstHour = slots[0]?.hour ?? 0
  const first = hourly[0]
  if (!first) return null

  const center = (index: number) => uvBarCenter(index, count, width)
  const x0 = center(0)
  const x1 = center(count - 1)
  // Bar centers are evenly spaced, and so are the bezier's control x-coords, so
  // x(t) is linear in t and t = index / (count - 1) lands exactly over bar `index`.
  const tForIndex = (index: number) => (count > 1 ? clamp(index / (count - 1), 0, 1) : 0.5)
  const pointAt = (t: number) => {
    const mt = 1 - t
    return {
      x: x0 + (x1 - x0) * t,
      y: mt * mt * BASELINE_Y + 2 * mt * t * CONTROL_Y + t * t * BASELINE_Y,
    }
  }
  const indexOfHour = (hour: number) =>
    hour >= firstHour && hour < firstHour + count ? hour - firstHour : -1
  /** Fractional bar index for a fractional hour (10.5 sits halfway from 10am to 11am). */
  const indexForTime = (time: number) => {
    const whole = indexOfHour(Math.floor(time))
    if (whole < 0) return null
    return whole + (time - Math.floor(time))
  }

  const peak = hourly.reduce((best, h) => (h.uv > best.uv ? h : best), first)
  const hasPeak = peak.uv >= 0.5
  const peakPoint = pointAt(tForIndex(indexOfHour(peak.hour)))
  const nowIndex = nowHour !== null ? indexForTime(nowHour) : null
  const nowPoint = nowIndex !== null ? pointAt(tForIndex(nowIndex)) : null
  const focusedIndex = focused ? indexOfHour(focused.hour) : -1
  const focusedPoint = focusedIndex >= 0 ? pointAt(tForIndex(focusedIndex)) : null
  // Hide the peak callout while the focus marker sits on the peak.
  const showPeakLabel = hasPeak && focused?.hour !== peak.hour
  const peakAnchor =
    peakPoint.x < 60 ? 'start' : peakPoint.x > width - 60 ? 'end' : ('middle' as const)

  // x-ranges with data on both sides: everything except each gap's span from the
  // last known hour before it to the first known hour after it.
  const gaps = missingRuns(slots)
  const knownSpans: Array<[number, number]> = []
  let spanStart = 0
  for (const [from, to] of gaps) {
    knownSpans.push([spanStart, center(indexOfHour(from) - 1)])
    spanStart = center(indexOfHour(to) + 1)
  }
  knownSpans.push([spanStart, width])

  const path = `M ${x0} ${BASELINE_Y} Q ${(x0 + x1) / 2} ${CONTROL_Y} ${x1} ${BASELINE_Y}`

  // Map a pointer x (client px) to the nearest bar's hour, then report it upward.
  function selectFromClientX(svg: SVGSVGElement, clientX: number) {
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || count === 0) return
    const pitch = (rect.width + UV_BAR_GAP) / count
    const index = clamp(Math.floor((clientX - rect.left + UV_BAR_GAP / 2) / pitch), 0, count - 1)
    // A gap has nothing to inspect: snap to the nearest hour that has data.
    let h = slots[index]?.data ?? null
    for (let d = 1; !h && d < count; d++)
      h = slots[index - d]?.data ?? slots[index + d]?.data ?? null
    if (h) onSelectHour(h)
  }

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      style={{
        height: `${HEIGHT}px`,
        marginBottom: '6px',
        borderRadius: '12px',
        background: 'linear-gradient(180deg, rgba(251,191,36,0.13), rgba(249,115,22,0.05))',
        overflow: 'hidden',
      }}
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          style={{ display: 'block', cursor: 'pointer', touchAction: 'pan-x pan-y' }}
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
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
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
            <circle
              cx={peakPoint.x}
              cy={peakPoint.y}
              r="6"
              fill="rgba(249,115,22,0.18)"
              stroke="rgba(249,115,22,0.85)"
              strokeWidth="2"
            />
          )}
          {showPeakLabel && (
            <text
              x={peakPoint.x}
              y={peakPoint.y - 14}
              textAnchor={peakAnchor}
              fill="#EA580C"
              fontSize="11.5"
              fontWeight="700"
            >
              Peak {peak.uv.toFixed(1)}
              <tspan fontWeight="500" fill="var(--text-3)">
                {' '}
                · {fmt.hour(peak.hour)}
              </tspan>
            </text>
          )}

          {nowPoint && (
            <>
              <circle cx={nowPoint.x} cy={nowPoint.y} r="18" fill="url(#sunGlow)" />
              <circle
                cx={nowPoint.x}
                cy={nowPoint.y}
                r="7"
                fill="#FBBF24"
                stroke="#F97316"
                strokeWidth="2"
              />
            </>
          )}

          {focusedPoint && (
            <>
              <line
                x1={focusedPoint.x}
                y1={focusedPoint.y}
                x2={focusedPoint.x}
                y2={BASELINE_Y}
                stroke="rgba(249,115,22,0.35)"
                strokeWidth="1.5"
                strokeDasharray="3 4"
              />
              <circle
                cx={focusedPoint.x}
                cy={focusedPoint.y}
                r="9"
                fill="rgba(255,255,255,0.9)"
                stroke="#F97316"
                strokeWidth="2.5"
              />
              <circle cx={focusedPoint.x} cy={focusedPoint.y} r="3.5" fill="#F97316" />
            </>
          )}
        </svg>
      )}
    </div>
  )
}
