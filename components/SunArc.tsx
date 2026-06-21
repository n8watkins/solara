'use client'
import { useRef } from 'react'
import { HourlyForecast } from '@/lib/types'
import { fmtHour, uvLabel, uvColorHex } from '@/lib/weather'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  isToday: boolean
  /** The hour currently being inspected (shared with the UV strip below). */
  focused: HourlyForecast | null
  /** Select an hour by tapping/dragging the arc — drives the shared focus. */
  onSelectHour: (h: HourlyForecast) => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// The drawn curve is the quadratic bezier  M P0 Q P1 P2.  Its three x-coords are
// equally spaced (34, 160, 286), so x(t) = 34 + 252·t is LINEAR in t — meaning a
// marker placed at t = hour-progress sits exactly ON the line AND its x maps 1:1
// to the hour, lining the arc up with the UV strip directly beneath it.
const P0 = { x: 34, y: 118 }
const P1 = { x: 160, y: 12 }
const P2 = { x: 286, y: 118 }
const VIEW_W = 320
// Extra room below the baseline (y=118) for the hour-tick labels and above the
// peak for its callout — the viewBox is taller than the curve so nothing clips.
const VIEW_H = 150
const BASELINE_Y = 118
const TICK_LABEL_Y = 138

/** Point on the *drawn* quadratic bezier at parameter t∈[0,1]. */
function pointOnArc(t: number) {
  const mt = 1 - t
  return {
    x: mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x,
    y: mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y,
  }
}

export default function SunArc({ hourly, currentHour, isToday, focused, onSelectHour }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  if (!hourly.length) return null

  const firstHour = hourly[0].hour
  const lastHour = hourly[hourly.length - 1].hour
  const peak = hourly.reduce((best, h) => h.uv > best.uv ? h : best, hourly[0])
  const current = hourly.find(h => h.hour === currentHour)

  const hourToProgress = (hour: number) => {
    const denominator = Math.max(1, lastHour - firstHour)
    return clamp((hour - firstHour) / denominator, 0, 1)
  }
  const xForHour = (hour: number) => P0.x + (P2.x - P0.x) * hourToProgress(hour)

  // Gradient stops mapping each hour's UV color along the (horizontal-in-x, so
  // linear-in-hour) arc — the line visually reflects UV intensity hour by hour.
  const uvStops = hourly.map(h => ({
    offset: hourToProgress(h.hour) * 100,
    color: uvColorHex(h.uv),
  }))

  // Hour ticks roughly every 3 hours across the span, anchored to the actual
  // hours present so labels line up with the bars on the strip beneath.
  const tickHours: number[] = []
  for (const h of hourly) {
    if (h.hour % 3 === 0) tickHours.push(h.hour)
  }
  // Always include the final hour so the right edge of the day is labelled.
  if (tickHours[tickHours.length - 1] !== lastHour) tickHours.push(lastHour)

  const peakPoint = pointOnArc(hourToProgress(peak.hour))
  const currentPoint = isToday && current ? pointOnArc(hourToProgress(current.hour)) : null
  const focusedPoint = focused ? pointOnArc(hourToProgress(focused.hour)) : null
  const focusLabel = focused ? `UV ${focused.uv.toFixed(1)} · ${uvLabel(focused.uv)}` : null
  // The peak callout is hidden when the focus marker sits on (or right next to)
  // the peak, so the two labels never overlap.
  const showPeakLabel = !focused || Math.abs(focused.hour - peak.hour) > 0

  // Map a pointer x (client px) to the nearest hour, then report it upward.
  function selectFromClientX(clientX: number) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return
    // SVG x in viewBox units (preserveAspectRatio="none" → straight scale).
    const svgX = ((clientX - rect.left) / rect.width) * VIEW_W
    // x = 34 + 252·t  ⇒  t = (x − 34) / 252.  Same mapping the markers use.
    const t = clamp((svgX - P0.x) / (P2.x - P0.x), 0, 1)
    const targetHour = firstHour + t * (lastHour - firstHour)
    const nearest = hourly.reduce((best, h) =>
      Math.abs(h.hour - targetHour) < Math.abs(best.hour - targetHour) ? h : best, hourly[0])
    onSelectHour(nearest)
  }

  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '14px',
      padding: '10px 14px 6px',
      marginBottom: '10px',
      userSelect: 'none', WebkitUserSelect: 'none',
      background: 'linear-gradient(180deg, rgba(251,191,36,0.13), rgba(249,115,22,0.05))',
      border: '0.5px solid rgba(251,191,36,0.24)',
    }}>
      <div className="sun-arc-plot" style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer', touchAction: 'pan-y' }}
          role="slider"
          aria-label="Sun path — scrub to an hour"
          aria-valuemin={firstHour}
          aria-valuemax={lastHour}
          aria-valuenow={focused?.hour ?? currentHour}
          aria-valuetext={focused ? `${fmtHour(focused.hour)}, ${focusLabel}` : undefined}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); selectFromClientX(e.clientX) }}
          onPointerMove={(e) => { if (dragging.current) selectFromClientX(e.clientX) }}
          onPointerUp={() => { dragging.current = false }}
          onPointerCancel={() => { dragging.current = false }}
        >
          <defs>
            {/* gradientUnits=userSpaceOnUse so offsets map to x=34..286 — the arc's
                horizontal span, which is linear in hour — keeping each color aligned
                with the hour beneath it on the UV strip. */}
            <linearGradient id="sunArcLine" gradientUnits="userSpaceOnUse" x1={P0.x} x2={P2.x} y1="0" y2="0">
              {uvStops.map((s, i) => (
                <stop key={i} offset={`${s.offset}%`} stopColor={s.color} />
              ))}
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(251,191,36,0.48)" />
              <stop offset="100%" stopColor="rgba(251,191,36,0)" />
            </radialGradient>
          </defs>

          {/* Hour-tick guides + labels along the bottom, aligned to hour x-positions. */}
          {tickHours.map(h => {
            const x = xForHour(h)
            return (
              <g key={`tick-${h}`}>
                <line x1={x} y1={BASELINE_Y} x2={x} y2={BASELINE_Y + 4} stroke="rgba(156,163,175,0.45)" strokeWidth="1" />
                <text x={x} y={TICK_LABEL_Y} textAnchor="middle" fill="var(--text-3)" fontSize="9.5" fontWeight="600">{fmtHour(h)}</text>
              </g>
            )
          })}

          <path d="M 34 118 Q 160 12 286 118" fill="none" stroke="url(#sunArcLine)" strokeWidth="4" strokeLinecap="round" />
          <path d="M 34 118 Q 160 12 286 118" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="1" strokeLinecap="round" strokeDasharray="4 7" />
          <line x1="34" y1="118" x2="286" y2="118" stroke="rgba(156,163,175,0.24)" strokeWidth="1" />

          {/* Peak marker + on-arc callout (the header "Peak X at Ypm" line was
              removed, so the peak is surfaced here instead). */}
          <circle cx={peakPoint.x} cy={peakPoint.y} r={isToday ? 6 : 7} fill="rgba(249,115,22,0.18)" stroke="rgba(249,115,22,0.85)" strokeWidth="2" />
          {showPeakLabel && (
            <>
              <text x={peakPoint.x} y={peakPoint.y - 20} textAnchor="middle" fill="#F97316" fontSize="11" fontWeight="700">Peak {peak.uv.toFixed(1)}</text>
              <text x={peakPoint.x} y={peakPoint.y - 10} textAnchor="middle" fill="rgba(249,115,22,0.75)" fontSize="9">{fmtHour(peak.hour)}</text>
            </>
          )}

          {/* "Now" glow on today. */}
          {currentPoint && (
            <>
              <circle cx={currentPoint.x} cy={currentPoint.y} r="18" fill="url(#sunGlow)" />
              <circle cx={currentPoint.x} cy={currentPoint.y} r="7" fill="#FBBF24" stroke="#F97316" strokeWidth="2" />
            </>
          )}

          {/* Movable focus marker — sits exactly on the bezier at the focused hour. */}
          {focusedPoint && (
            <>
              <line x1={focusedPoint.x} y1={focusedPoint.y} x2={focusedPoint.x} y2="118" stroke="rgba(249,115,22,0.35)" strokeWidth="1.5" strokeDasharray="3 4" />
              <circle cx={focusedPoint.x} cy={focusedPoint.y} r="9" fill="rgba(255,255,255,0.9)" stroke="#F97316" strokeWidth="2.5" />
              <circle cx={focusedPoint.x} cy={focusedPoint.y} r="3.5" fill="#F97316" />
            </>
          )}
        </svg>
      </div>
    </div>
  )
}
