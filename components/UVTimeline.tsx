'use client'

import { useState } from 'react'
import { HourlyForecast } from '@/lib/types'
import { uvColorHex, uvTextHex, uvLabel, fmtHour, burnMins } from '@/lib/weather'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
}

export default function UVTimeline({ hourly, currentHour }: Props) {
  const [hovered, setHovered] = useState<HourlyForecast | null>(null)

  return (
    <div>
      <div className="flex gap-1 mb-1.5">
        {hourly.map(h => {
          const bg = uvColorHex(h.uv)
          const tx = uvTextHex(h.uv)
          const isNow = h.hour === currentHour
          return (
            <div
              key={h.hour}
              className={`flex-1 rounded-md flex flex-col items-center justify-center py-2 cursor-default transition-opacity ${
                isNow ? 'ring-2 ring-gray-800 ring-offset-1' : ''
              }`}
              style={{ background: bg, minWidth: 0 }}
              onMouseEnter={() => setHovered(h)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="text-xs font-semibold leading-none" style={{ color: tx }}>
                {h.uv.toFixed(1)}
              </span>
              <span className="text-[9px] mt-0.5 opacity-70" style={{ color: tx }}>
                {fmtHour(h.hour)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="h-8 flex items-center px-1">
        {hovered ? (
          <p className="text-xs text-gray-600">
            <span className="font-medium text-gray-900">{fmtHour(hovered.hour)}</span>
            {' · '}UV {hovered.uv.toFixed(1)} — {uvLabel(hovered.uv)}
            {' · '}{hovered.tempF}°F · {hovered.condition}
            {burnMins(hovered.uv, 'fair')
              ? ` · Burn in ~${burnMins(hovered.uv, 'fair')}m (fair skin)`
              : ' · No burn risk'
            }
          </p>
        ) : (
          <p className="text-xs text-gray-400">Hover a bar for details</p>
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
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
