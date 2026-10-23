'use client'

import { useState, useRef, useEffect, useId, type ReactNode } from 'react'
import type { HourlyForecast } from '@/lib/types'
import { uvColorHex, uvTextHex, fmtHour, formatUV, uvLabel } from '@/lib/weather'

/** Space between bars, in px. SunArc uses it to put each hour above its bar. */
export const UV_BAR_GAP = 4
/** Narrowest a bar may get; below this the strip scrolls instead of squeezing. */
export const UV_BAR_MIN_WIDTH = 42

/** Horizontal center (px) of bar `index` of `count` bars spread across `width` px. */
export function uvBarCenter(index: number, count: number, width: number): number {
  const barWidth = (width - (count - 1) * UV_BAR_GAP) / count
  return index * (barWidth + UV_BAR_GAP) + barWidth / 2
}

/** One-sentence summary of the day for screen readers (the strip's description). */
export function uvDaySummary(hourly: HourlyForecast[]): string {
  const first = hourly[0]
  if (!first) return 'No UV forecast for this day.'
  const peak = hourly.reduce((best, h) => (h.uv > best.uv ? h : best), first)
  const parts = [
    `UV peaks at ${peak.uv.toFixed(1)}, ${uvLabel(peak.uv)}, at ${fmtHour(peak.hour)}.`,
  ]
  const high = hourly.filter(h => h.uv > 5)
  const firstHigh = high[0]
  const lastHigh = high.at(-1)
  if (firstHigh && lastHigh) {
    parts.push(
      firstHigh === lastHigh
        ? `High or above at ${fmtHour(firstHigh.hour)}.`
        : `High or above from ${fmtHour(firstHigh.hour)} to ${fmtHour(lastHigh.hour)}.`,
    )
  }
  return parts.join(' ')
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  /**
   * Rendered inside the scroller, above the bars and at the same width (the sun
   * path), so it lines up with the bars and scrolls with them.
   */
  above?: ReactNode
  /** Notifies parent of the focused hour (current or tapped) — e.g. for a synced sun path. */
  onFocusHour?: (h: HourlyForecast | null) => void
  /**
   * Controlled focus. When provided, the highlighted hour is driven by the parent
   * (shared with the sun path + the card's big readout) instead of local tap state;
   * `onSelectHour` reports taps/scrolls back up. Omit both to keep standalone behavior.
   */
  focused?: HourlyForecast | null
  onSelectHour?: (h: HourlyForecast) => void
}

/**
 * Interactive hourly UV strip. Bars are a fixed width and the strip scrolls
 * horizontally on phones (zoomed in, more room per hour) with the current hour
 * auto-centered. Tapping a bar — or scrolling so a bar lands nearest the strip's
 * horizontal center — pins that hour as the shared focus, which drives the card's
 * big readout and the sun-path marker (no separate readout lives here anymore, so
 * the selected hour's stats appear in exactly one place). Numbers are
 * non-selectable so a tap never triggers the OS text/“search” menu.
 */
export default function UVTimeline({
  hourly,
  currentHour,
  onFocusHour,
  focused,
  onSelectHour,
  above,
}: Props) {
  const summaryId = useId()
  // Controlled when the parent passes ownership of the focus (shared with the sun
  // path); otherwise this local `selected` state drives the highlight on its own.
  const controlled = onSelectHour !== undefined
  const [selected, setSelected] = useState<HourlyForecast | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const nowRef = useRef<HTMLButtonElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  // True while WE are programmatically scrolling the strip (centering a tapped /
  // externally-focused hour) so the scroll handler doesn't echo that motion back
  // up as a fresh selection — which would fight taps and the arc.
  const programmaticScroll = useRef(false)
  const programmaticTimer = useRef<number | null>(null)

  // The highlighted hour. Controlled: only an explicit focus is highlighted, so with
  // nothing scrubbed no bar claims to be the "now" reading (the parent's readout
  // shows the live value; the current hour keeps its ring). Uncontrolled: a tap
  // wins, else the current hour, else the first hour of the day.
  const localActive = selected ?? hourly.find(h => h.hour === currentHour) ?? hourly[0] ?? null
  const active = controlled ? (focused ?? null) : localActive

  function selectHour(h: HourlyForecast) {
    if (controlled) onSelectHour!(h)
    else setSelected(h)
  }

  // Center a bar in the scroller, flagging the motion as programmatic so the scroll
  // handler ignores it (avoids a scroll→select→scroll feedback loop).
  function centerHour(el: HTMLElement | null) {
    const strip = stripRef.current
    if (!el || !strip) return
    programmaticScroll.current = true
    // Scroll the strip's OWN overflow — not el.scrollIntoView(), which can also
    // scroll the whole page vertically when the UV card is below the fold on load.
    strip.scrollLeft = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2
    if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
    // The scrollLeft write fires a scroll event; hold the flag long enough for it
    // to settle, then resume scroll-driven selection.
    programmaticTimer.current = window.setTimeout(() => {
      programmaticScroll.current = false
    }, 250)
  }

  // Center the current hour in the scroller on mount / when the day changes.
  useEffect(() => {
    centerHour(nowRef.current)
  }, [currentHour, hourly.length])

  // When the parent moves the focus (a tap on the arc, or the big readout updating),
  // bring that hour into view so the strip tracks the shared focus — "move the bar
  // along with displaying the new stats." Skipped when the focus is already the
  // bar nearest center (e.g. when WE drove the change via scroll).
  useEffect(() => {
    if (!controlled || !focused) return
    const strip = stripRef.current
    if (!strip) return
    const bar = strip.querySelector<HTMLElement>(`[data-hour="${focused.hour}"]`)
    if (!bar) return
    if (nearestHourToCenter() === focused.hour) return
    centerHour(bar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, focused?.hour])

  // The hour of the bar whose center is closest to the strip's horizontal center.
  function nearestHourToCenter(): number | null {
    const strip = stripRef.current
    if (!strip) return null
    const stripMid = strip.scrollLeft + strip.clientWidth / 2
    let bestHour: number | null = null
    let bestDist = Infinity
    for (const el of Array.from(strip.querySelectorAll<HTMLElement>('[data-hour]'))) {
      const mid = el.offsetLeft + el.offsetWidth / 2
      const dist = Math.abs(mid - stripMid)
      if (dist < bestDist) {
        bestDist = dist
        bestHour = Number(el.dataset.hour)
      }
    }
    return bestHour
  }

  // Scroll-sync: on horizontal scroll, focus the bar nearest the strip's center,
  // debounced to one update per animation frame. No-ops when the motion was
  // programmatic or when the nearest bar is already focused (prevents loops).
  function onScroll() {
    if (!controlled || programmaticScroll.current) return
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const hour = nearestHourToCenter()
      if (hour === null || hour === active?.hour) return
      const h = hourly.find(x => x.hour === hour)
      if (h) onSelectHour!(h)
    })
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
    },
    [],
  )

  // Only fire the legacy onFocusHour callback in uncontrolled mode — in controlled
  // mode the parent already owns the focus, so echoing it back would loop.
  useEffect(() => {
    if (!controlled) onFocusHour?.(active)
  }, [active, onFocusHour, controlled])

  return (
    <div style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      <p id={summaryId} style={visuallyHidden}>
        {uvDaySummary(hourly)}
      </p>
      <div
        className="uv-strip"
        ref={stripRef}
        onScroll={onScroll}
        role="group"
        aria-label="UV forecast by hour"
        aria-describedby={summaryId}
        // Positioned so bar offsetLeft is measured from the strip (used to center bars).
        style={{ position: 'relative' }}
      >
        {/* One column at least as wide as the strip: bars stretch to fill it on wide
            screens and keep their minimum width (scrolling) on phones; `above` shares
            the column, so it always spans exactly the bars. */}
        <div
          style={{
            flex: '1 0 auto',
            minWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {above}
          <div style={{ display: 'flex', gap: `${UV_BAR_GAP}px` }}>
            {hourly.map(h => {
              const isNow = h.hour === currentHour
              const isSel = active?.hour === h.hour
              return (
                <button
                  key={h.hour}
                  data-hour={h.hour}
                  ref={isNow ? nowRef : undefined}
                  onClick={() => selectHour(h)}
                  className="uv-bar"
                  aria-pressed={isSel}
                  aria-label={`${fmtHour(h.hour)}, UV ${h.uv.toFixed(1)}, ${uvLabel(h.uv)}${isNow ? ', current hour' : ''}`}
                  style={{
                    flex: `1 0 ${UV_BAR_MIN_WIDTH}px`,
                    minWidth: `${UV_BAR_MIN_WIDTH}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px',
                    padding: '12px 0',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    background: uvColorHex(h.uv),
                    color: uvTextHex(h.uv),
                    border: isSel ? '2px solid var(--text)' : '2px solid transparent',
                    boxShadow:
                      isNow && !isSel
                        ? '0 0 0 2px var(--bg-card), 0 0 0 3.5px var(--text)'
                        : 'none',
                    scrollSnapAlign: 'center',
                    transition: 'border-color 0.12s',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>
                    {formatUV(h.uv, { compact: true })}
                  </span>
                  <span style={{ fontSize: '10px', opacity: 0.75, lineHeight: 1 }}>
                    {fmtHour(h.hour)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowLegend(s => !s)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px 2px 4px',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
        }}
        aria-expanded={showLegend}
      >
        UV scale {showLegend ? '▲' : '▼'}
      </button>
      {showLegend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '4px' }}>
          {[
            ['#86EFAC', 'Low (0–2)'],
            ['#FCD34D', 'Moderate (3–5)'],
            ['#FB923C', 'High (6–7)'],
            ['#F87171', 'Very high (8–10)'],
            ['#C084FC', 'Extreme (11+)'],
          ].map(([color, label]) => (
            <span
              key={label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'var(--text-3)',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '3px',
                  background: color,
                  flexShrink: 0,
                }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
