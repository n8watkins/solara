import type { Ref } from 'react'
import { formatUV } from '@solara/core'
import type { LabelPlacement, Point } from '@/lib/sun-arc'
import { SUN_ARC_BASELINE_Y } from '@/lib/sun-arc'
import { useUnits } from '@/lib/use-units'

// Markers drawn on the sun path (components/SunArc.tsx), in SVG user space.

/** Outer radius of the "now" sun's disc, stroke included (the peak callout avoids it). */
export const NOW_SUN_RADIUS = 8
/** Outer radius of the focus ring, stroke included (the peak callout avoids it). */
export const FOCUS_MARKER_RADIUS = 10.25

/**
 * The day's peak: a ring, plus a "Peak 10.3 · 1pm" callout at `label` (its left
 * edge and baseline, from placePeakLabel) when set. `pointer` adds an arrow toward
 * a ring scrolled out of view on that side.
 */
export function PeakMarker({
  point,
  uv,
  hour,
  label,
  pointer = null,
  labelRef,
}: {
  point: Point
  uv: number
  hour: number
  label: LabelPlacement | null
  pointer?: 'left' | 'right' | null
  labelRef?: Ref<SVGTextElement>
}) {
  const fmt = useUnits()
  return (
    <>
      <circle
        data-testid="sun-arc-peak"
        cx={point.x}
        cy={point.y}
        r="6"
        fill="rgba(249,115,22,0.18)"
        stroke="rgba(249,115,22,0.85)"
        strokeWidth="2"
      />
      {label && (
        <text
          ref={labelRef}
          data-testid="sun-arc-peak-label"
          x={label.x}
          y={label.y}
          fill="var(--accent)"
          fontSize="11.5"
          fontWeight="700"
        >
          {pointer === 'left' && (
            <tspan fontWeight="500" fill="var(--text-3)">
              {'← '}
            </tspan>
          )}
          Peak {formatUV(uv)}
          <tspan fontWeight="500" fill="var(--text-3)">
            {' '}
            · {fmt.hour(hour)}
            {pointer === 'right' && ' →'}
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
        data-testid="sun-arc-now"
        cx={point.x}
        cy={point.y}
        r={NOW_SUN_RADIUS - 1}
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
        data-testid="sun-arc-focus"
        cx={point.x}
        cy={point.y}
        r={FOCUS_MARKER_RADIUS - 1.25}
        fill="rgba(255,255,255,0.9)"
        stroke="var(--brand)"
        strokeWidth="2.5"
      />
      <circle cx={point.x} cy={point.y} r="3.5" fill="var(--brand)" />
    </>
  )
}

/** Outer radius of the night marker's moon (the peak callout avoids it). */
export const NIGHT_MOON_RADIUS = 7

/**
 * "Now" while the sun is down: a crescent moon at the end of the day it sits
 * past (after sunset on the right, before sunrise on the left).
 */
export function NightMarker({ point, maskId }: { point: Point; maskId: string }) {
  const r = NIGHT_MOON_RADIUS
  return (
    <g data-testid="sun-arc-night">
      {/* A card-colored halo lifts the moon off the end of the line. */}
      <circle cx={point.x} cy={point.y} r={r + 3} fill="var(--bg-card)" />
      <mask id={maskId}>
        <circle cx={point.x} cy={point.y} r={r} fill="white" />
        <circle cx={point.x + r * 0.55} cy={point.y - r * 0.4} r={r * 0.8} fill="black" />
      </mask>
      <circle cx={point.x} cy={point.y} r={r} fill="var(--text-3)" mask={`url(#${maskId})`} />
    </g>
  )
}
