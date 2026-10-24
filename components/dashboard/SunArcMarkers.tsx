import type { Point } from '@/lib/sun-arc'
import { SUN_ARC_BASELINE_Y } from '@/lib/sun-arc'
import { useUnits } from '@/lib/use-units'

// Markers drawn on the sun path (components/SunArc.tsx), in SVG user space.

/** The day's peak: a ring, plus a "Peak 10.3 · 1pm" callout when `label` is set. */
export function PeakMarker({
  point,
  uv,
  hour,
  label,
  anchor,
}: {
  point: Point
  uv: number
  hour: number
  label: boolean
  anchor: 'start' | 'middle' | 'end'
}) {
  const fmt = useUnits()
  return (
    <>
      <circle
        cx={point.x}
        cy={point.y}
        r="6"
        fill="rgba(249,115,22,0.18)"
        stroke="rgba(249,115,22,0.85)"
        strokeWidth="2"
      />
      {label && (
        <text
          x={point.x}
          y={point.y - 14}
          textAnchor={anchor}
          fill="var(--accent)"
          fontSize="11.5"
          fontWeight="700"
        >
          Peak {uv.toFixed(1)}
          <tspan fontWeight="500" fill="var(--text-3)">
            {' '}
            · {fmt.hour(hour)}
          </tspan>
        </text>
      )}
    </>
  )
}

/** The sun at "now", with a soft glow (`glowId` names a radial gradient). */
export function NowSun({ point, glowId }: { point: Point; glowId: string }) {
  return (
    <>
      <circle cx={point.x} cy={point.y} r="18" fill={`url(#${glowId})`} />
      <circle
        cx={point.x}
        cy={point.y}
        r="7"
        fill="#FBBF24"
        stroke="var(--brand)"
        strokeWidth="2"
      />
    </>
  )
}

/** The scrubbed hour: a ring on the arc with a dashed drop line to the baseline. */
export function FocusMarker({ point }: { point: Point }) {
  return (
    <>
      <line
        x1={point.x}
        y1={point.y}
        x2={point.x}
        y2={SUN_ARC_BASELINE_Y}
        stroke="rgba(249,115,22,0.35)"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      <circle
        cx={point.x}
        cy={point.y}
        r="9"
        fill="rgba(255,255,255,0.9)"
        stroke="var(--brand)"
        strokeWidth="2.5"
      />
      <circle cx={point.x} cy={point.y} r="3.5" fill="var(--brand)" />
    </>
  )
}
