'use client'

import { useState, useRef, useEffect } from 'react'
import { HourlyForecast } from '@/lib/types'
import { uvColorHex, uvTextHex, uvLabel, fmtHour, formatUV, burnMins } from '@/lib/weather'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  skinType?: string
  /** Notifies parent of the focused hour (current or tapped) — e.g. for a synced sun path. */
  onFocusHour?: (h: HourlyForecast | null) => void
  /**
   * Controlled focus. When provided, the highlighted/read-out hour is driven by
   * the parent (shared with the sun path) instead of local tap state; `onSelectHour`
   * reports taps back up. Omit both to keep the standalone uncontrolled behavior.
   */
  focused?: HourlyForecast | null
  onSelectHour?: (h: HourlyForecast) => void
}

/**
 * Interactive hourly UV strip. Bars are a fixed width and the strip scrolls
 * horizontally on phones (zoomed in, more room per hour) with the current hour
 * auto-centered; tapping any hour pins its detail in the always-visible readout
 * below. Numbers are non-selectable so a tap never triggers the OS text/“search”
 * menu. The legend is collapsed behind a toggle to keep the focus on the readout.
 */
export default function UVTimeline({ hourly, currentHour, skinType = 'fair', onFocusHour, focused, onSelectHour }: Props) {
  // Controlled when the parent passes a `focused` hour (shared with the sun path);
  // otherwise this local `selected` state drives the readout on its own.
  const controlled = onSelectHour !== undefined
  const [selected, setSelected] = useState<HourlyForecast | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const nowRef = useRef<HTMLButtonElement>(null)

  // The hour whose detail is shown: a controlled focus / explicit tap wins, else
  // the current hour, else the first hour of the day.
  const localActive = selected ?? hourly.find(h => h.hour === currentHour) ?? hourly[0] ?? null
  const active = controlled
    ? (focused ?? hourly.find(h => h.hour === currentHour) ?? hourly[0] ?? null)
    : localActive

  function selectHour(h: HourlyForecast) {
    if (controlled) onSelectHour!(h)
    else setSelected(h)
  }

  // Center the current hour in the scroller on mount / when the day changes.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [currentHour, hourly.length])

  // Only fire the legacy onFocusHour callback in uncontrolled mode — in controlled
  // mode the parent already owns the focus, so echoing it back would loop.
  useEffect(() => { if (!controlled) onFocusHour?.(active) }, [active, onFocusHour, controlled])

  return (
    <div style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      <div className="uv-strip">
        {hourly.map(h => {
          const isNow = h.hour === currentHour
          const isSel = active?.hour === h.hour
          return (
            <button
              key={h.hour}
              ref={isNow ? nowRef : undefined}
              onClick={() => selectHour(h)}
              className="uv-bar"
              aria-pressed={isSel}
              aria-label={`${fmtHour(h.hour)}, UV ${h.uv.toFixed(1)}`}
              style={{
                flex: '0 0 auto', width: '42px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px',
                padding: '9px 0', borderRadius: '10px', cursor: 'pointer',
                background: uvColorHex(h.uv), color: uvTextHex(h.uv),
                border: isSel ? '2px solid var(--text)' : '2px solid transparent',
                boxShadow: isNow && !isSel ? '0 0 0 2px var(--bg-card), 0 0 0 3.5px var(--text)' : 'none',
                scrollSnapAlign: 'center', transition: 'border-color 0.12s',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>{formatUV(h.uv, { compact: true })}</span>
              <span style={{ fontSize: '10px', opacity: 0.75, lineHeight: 1 }}>{fmtHour(h.hour)}</span>
              {isNow && <span style={{ fontSize: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1 }}>now</span>}
            </button>
          )
        })}
      </div>

      {/* Always-visible readout for the focused hour. */}
      <div style={{ minHeight: '2.1rem', display: 'flex', alignItems: 'center', padding: '8px 2px 0', fontSize: '13px', color: 'var(--text-2)' }}>
        {active ? (
          <p style={{ margin: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmtHour(active.hour)}</span>
            {' · UV '}
            <span style={{ fontWeight: 700, color: uvColorHex(active.uv) }}>{active.uv.toFixed(1)} {uvLabel(active.uv)}</span>
            {` · ${active.tempF}°F · ${active.condition}`}
            {burnMins(active.uv, skinType as never) ? ` · burn ~${burnMins(active.uv, skinType as never)}m` : ' · no burn risk'}
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-3)' }}>Tap an hour for details</p>
        )}
      </div>

      <button
        onClick={() => setShowLegend(s => !s)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
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
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-3)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
