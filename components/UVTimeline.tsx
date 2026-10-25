'use client'

import {
  useState,
  useRef,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  type ReactNode,
  type Ref,
} from 'react'
import type { HourlyForecast } from '@/lib/types'
import { useUnits } from '@/lib/use-units'
import { UV_STRIP_EDGE_FADE, hourSlots, uvDaySummary } from '@/lib/uv-strip'
import VisuallyHidden from './VisuallyHidden'
import { UVBar, UVGap } from './dashboard/UVBar'
import UVScaleLegend from './dashboard/UVScaleLegend'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  /**
   * Rendered inside the scroller, above the bars and at the same width (the sun
   * path), so it lines up with the bars and scrolls with them.
   */
  above?: ReactNode
  /** Notifies parent of the focused hour (current or tapped) - e.g. for a synced sun path. */
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
 * auto-centered. Tapping a bar - or scrolling so a bar lands nearest the strip's
 * horizontal center - pins that hour as the shared focus, which drives the card's
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
  const fmt = useUnits()
  // Controlled when the parent passes ownership of the focus (shared with the sun
  // path); otherwise this local `selected` state drives the highlight on its own.
  const controlled = onSelectHour !== undefined
  const [selected, setSelected] = useState<HourlyForecast | null>(null)
  const nowRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  // True while WE are programmatically scrolling the strip (centering a tapped /
  // externally-focused hour) so the scroll handler doesn't echo that motion back
  // up as a fresh selection - which would fight taps and the arc.
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
    // Scroll the strip's OWN overflow - not el.scrollIntoView(), which can also
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
  // After the day's last hour (the sun is down), "now" is past the end, so the strip
  // rests there instead, beside the sun path's night marker.
  const lastHour = hourly.at(-1)?.hour
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!nowRef.current && strip && lastHour !== undefined && currentHour > lastHour) {
      programmaticScroll.current = true
      strip.scrollLeft = strip.scrollWidth
      updateEdgeFades()
      if (programmaticTimer.current) window.clearTimeout(programmaticTimer.current)
      programmaticTimer.current = window.setTimeout(() => {
        programmaticScroll.current = false
      }, 250)
      return
    }
    centerHour(nowRef.current)
  }, [currentHour, hourly.length, lastHour])

  // The phone strip's edge fade (globals.css) only covers a side with more hours to
  // scroll to, growing with the distance scrolled, so a strip resting at either end
  // shows that end's bar whole instead of cut off.
  function updateEdgeFades() {
    const strip = stripRef.current
    if (!strip) return
    const fade = (px: number) => `${Math.round(Math.min(UV_STRIP_EDGE_FADE, Math.max(0, px)))}px`
    const rest = strip.scrollWidth - strip.clientWidth - strip.scrollLeft
    strip.style.setProperty('--strip-fade-start', fade(strip.scrollLeft))
    strip.style.setProperty('--strip-fade-end', fade(rest))
  }
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    updateEdgeFades()
    const observer = new ResizeObserver(updateEdgeFades)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [hourly.length])

  // The hour of the bar whose center is closest to the strip's horizontal center.
  function nearestHourToCenter(): number | null {
    const strip = stripRef.current
    if (!strip) return null
    const stripMid = strip.scrollLeft + strip.clientWidth / 2
    let bestHour: number | null = null
    let bestDist = Infinity
    for (const el of Array.from(strip.querySelectorAll<HTMLElement>('button[data-hour]'))) {
      const mid = el.offsetLeft + el.offsetWidth / 2
      const dist = Math.abs(mid - stripMid)
      if (dist < bestDist) {
        bestDist = dist
        bestHour = Number(el.dataset.hour)
      }
    }
    return bestHour
  }

  // When the parent moves the focus (a tap on the arc, or the big readout updating),
  // bring that hour into view so the strip tracks the shared focus - "move the bar
  // along with displaying the new stats." Skipped when the focus is already the
  // bar nearest center (e.g. when WE drove the change via scroll).
  const focusedHour = controlled ? (focused?.hour ?? null) : null
  const followFocus = useEffectEvent((hour: number) => {
    const bar = stripRef.current?.querySelector<HTMLElement>(`[data-hour="${hour}"]`)
    if (!bar || nearestHourToCenter() === hour) return
    centerHour(bar)
  })
  useEffect(() => {
    if (focusedHour !== null) followFocus(focusedHour)
  }, [focusedHour])

  // Scroll-sync: on horizontal scroll, focus the bar nearest the strip's center,
  // debounced to one update per animation frame. No-ops when the motion was
  // programmatic or when the nearest bar is already focused (prevents loops).
  function onScroll() {
    updateEdgeFades()
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

  // Only fire the legacy onFocusHour callback in uncontrolled mode - in controlled
  // mode the parent already owns the focus, so echoing it back would loop.
  useEffect(() => {
    if (!controlled) onFocusHour?.(active)
  }, [active, onFocusHour, controlled])

  return (
    <div className="select-none">
      <VisuallyHidden id={summaryId}>{uvDaySummary(hourly, fmt.hour)}</VisuallyHidden>
      {/* Positioned so bar offsetLeft is measured from the strip (used to center bars). */}
      <div
        className="uv-strip relative"
        ref={stripRef}
        onScroll={onScroll}
        role="group"
        aria-label="UV forecast by hour"
        aria-describedby={summaryId}
      >
        {/* One column at least as wide as the strip: bars stretch to fill it on wide
            screens and keep their minimum width (scrolling) on phones; `above` shares
            the column, so it always spans exactly the bars. */}
        <div className="flex min-w-full flex-[1_0_auto] flex-col">
          {above}
          {/* gap-1 is UV_BAR_GAP (4px), which SunArc's geometry assumes. */}
          <div className="flex gap-1">
            {hourSlots(hourly).map(({ hour, data: h }) => {
              const isNow = hour === currentHour
              return h ? (
                <UVBar
                  key={hour}
                  hour={h}
                  isNow={isNow}
                  selected={active?.hour === h.hour}
                  onSelect={() => selectHour(h)}
                  ref={isNow ? (nowRef as Ref<HTMLButtonElement>) : undefined}
                />
              ) : (
                <UVGap
                  key={hour}
                  hour={hour}
                  isNow={isNow}
                  ref={isNow ? (nowRef as Ref<HTMLDivElement>) : undefined}
                />
              )
            })}
          </div>
        </div>
      </div>

      <UVScaleLegend />
    </div>
  )
}
