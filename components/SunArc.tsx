'use client'
import { HourlyForecast } from '@/lib/types'
import { fmtHour, uvLabel } from '@/lib/weather'

interface Props {
  hourly: HourlyForecast[]
  currentHour: number
  isToday: boolean
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function pointOnArc(progress: number) {
  const angle = Math.PI * (1 - progress)
  const cx = 160
  const cy = 118
  const rx = 126
  const ry = 78
  return {
    x: cx + Math.cos(angle) * rx,
    y: cy - Math.sin(angle) * ry,
  }
}

export default function SunArc({ hourly, currentHour, isToday }: Props) {
  if (!hourly.length) return null

  const firstHour = hourly[0].hour
  const lastHour = hourly[hourly.length - 1].hour
  const peak = hourly.reduce((best, h) => h.uv > best.uv ? h : best, hourly[0])
  const current = hourly.find(h => h.hour === currentHour)

  const hourToProgress = (hour: number) => {
    const denominator = Math.max(1, lastHour - firstHour)
    return clamp((hour - firstHour) / denominator, 0, 1)
  }

  const peakPoint = pointOnArc(hourToProgress(peak.hour))
  const currentPoint = isToday && current ? pointOnArc(hourToProgress(current.hour)) : null
  const currentLabel = current ? `UV ${current.uv.toFixed(1)} · ${uvLabel(current.uv)}` : 'Current hour outside visible range'

  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '16px',
      padding: '16px 18px 14px',
      marginBottom: '14px',
      background: 'linear-gradient(180deg, rgba(251,191,36,0.13), rgba(249,115,22,0.05))',
      border: '0.5px solid rgba(251,191,36,0.24)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start', marginBottom: '4px', position: 'relative', zIndex: 2 }}>
        <div>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 750, color: 'var(--text)' }}>Sun path</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>
            Follow the sun across your outdoor window.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>Peak UV</p>
          <p style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 800, color: 'var(--accent)' }}>{peak.uv.toFixed(1)}</p>
        </div>
      </div>

      <div style={{ position: 'relative', height: '132px' }}>
        <svg viewBox="0 0 320 140" preserveAspectRatio="none" style={{ width: '100%', height: '132px', display: 'block' }} aria-hidden="true">
          <defs>
            <linearGradient id="sunArcLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="rgba(249,115,22,0.15)" />
              <stop offset="50%" stopColor="rgba(249,115,22,0.7)" />
              <stop offset="100%" stopColor="rgba(249,115,22,0.15)" />
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(251,191,36,0.48)" />
              <stop offset="100%" stopColor="rgba(251,191,36,0)" />
            </radialGradient>
          </defs>
          <path d="M 34 118 Q 160 12 286 118" fill="none" stroke="url(#sunArcLine)" strokeWidth="4" strokeLinecap="round" />
          <path d="M 34 118 Q 160 12 286 118" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="1" strokeLinecap="round" strokeDasharray="4 7" />
          <line x1="34" y1="118" x2="286" y2="118" stroke="rgba(156,163,175,0.24)" strokeWidth="1" />
          <circle cx={peakPoint.x} cy={peakPoint.y} r="7" fill="rgba(249,115,22,0.18)" stroke="rgba(249,115,22,0.85)" strokeWidth="2" />
          {currentPoint && (
            <>
              <circle cx={currentPoint.x} cy={currentPoint.y} r="22" fill="url(#sunGlow)" />
              <circle cx={currentPoint.x} cy={currentPoint.y} r="9" fill="#FBBF24" stroke="#F97316" strokeWidth="2" />
            </>
          )}
        </svg>

        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '2px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-3)' }}>
          <span>{fmtHour(firstHour)}</span>
          <span>Midday</span>
          <span>{fmtHour(lastHour)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', borderTop: '0.5px solid rgba(249,115,22,0.14)', paddingTop: '10px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>
          {isToday ? `Now: ${currentLabel}` : 'Viewing a future day · current sun marker hidden'}
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>
          Peak at {fmtHour(peak.hour)}
        </p>
      </div>
    </div>
  )
}
