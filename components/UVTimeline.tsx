'use client'

import { useState } from 'react'
import { HourlyForecast } from '@/lib/types'
import { uvColorHex, uvTextHex, uvLabel, fmtHour, burnMins } from '@/lib/weather'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  skinType?: string
}

export default function UVTimeline({ hourly, currentHour, skinType = 'fair' }: Props) {
  const [hovered, setHovered] = useState<HourlyForecast | null>(null)

  const first = hourly[0]
  const last  = hourly[hourly.length - 1]

  return (
    <div>
      {/* Bars share the row evenly — must never overflow into a horizontal scroll. */}
      <div className="flex gap-0.5 sm:gap-1 mb-1.5">
        {hourly.map(h => {
          const bg   = uvColorHex(h.uv)
          const tx   = uvTextHex(h.uv)
          const isNow = h.hour === currentHour
          return (
            <div
              key={h.hour}
              className={`rounded-md flex flex-col items-center justify-center py-2 cursor-default transition-opacity ${
                isNow ? 'ring-2 ring-gray-800 ring-offset-1' : ''
              }`}
              style={{ background: bg, minWidth: 0, flex: '1 1 0' }}
              onMouseEnter={() => setHovered(h)}
              onMouseLeave={() => setHovered(null)}
              onTouchStart={() => setHovered(h)}
            >
              <span className="text-[11px] font-semibold leading-none" style={{ color: tx }}>
                {h.uv >= 10 ? Math.round(h.uv) : h.uv.toFixed(1)}
              </span>
              <span className="hide-mobile text-[9px] mt-0.5 opacity-70" style={{ color: tx }}>
                {fmtHour(h.hour)}
              </span>
              {isNow && (
                <span className="text-[8px] mt-0.5 font-medium" style={{ color: tx }}>•</span>
              )}
            </div>
          )
        })}
      </div>

      {/* On mobile the per-bar hour labels are hidden; this axis stands in. */}
      <div className="show-mobile justify-between text-[10px] text-gray-400 px-0.5">
        <span>{fmtHour(first.hour)}</span>
        <span>{fmtHour(Math.round((first.hour + last.hour) / 2))}</span>
        <span>{fmtHour(last.hour)}</span>
      </div>

      <div className="h-8 flex items-center px-1 min-h-[2rem]">
        {hovered ? (
          <p className="text-xs text-gray-600">
            <span className="font-medium text-gray-900">{fmtHour(hovered.hour)}</span>
            {' · '}UV <span style={{ color: uvColorHex(hovered.uv) }} className="font-medium">
              {hovered.uv.toFixed(1)} — {uvLabel(hovered.uv)}
            </span>
            {' · '}{hovered.tempF}°F · {hovered.condition}
            {burnMins(hovered.uv, skinType as any)
              ? ` · Burn in ~${burnMins(hovered.uv, skinType as any)}m`
              : ' · No burn risk'
            }
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            {typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches ? 'Tap a bar for details' : 'Hover a bar for details'}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {[
          ['#86EFAC', 'Low (0–2)'],
          ['#FCD34D', 'Moderate (3–5)'],
          ['#FB923C', 'High (6–7)'],
          ['#F87171', 'Very high (8–10)'],
          ['#C084FC', 'Extreme (11+)'],
        ].map(([color, label]) => (
          <span key={label} className="flex items-center gap-1 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
