'use client'
import { useEffect, useState } from 'react'
import { UserPreferences } from '@/lib/types'
import { canUseCalendar } from '@/lib/tiers'
import { DayForecast, SafeWindow, getSafeWindows, gcalWindowLink, fmtH, uvBg } from '@/lib/calendar'

interface Props {
  prefs: UserPreferences
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6) // 6am–7pm

export default function CalendarView({ prefs }: Props) {
  const [days,    setDays]    = useState<DayForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ day: string; act: string; win: SafeWindow } | null>(null)

  const tier = prefs.tier || 'anonymous'
  const calOk = canUseCalendar(tier)

  useEffect(() => {
    async function fetch7Day() {
      setLoading(true); setError(null)
      try {
        const { lat, lon } = prefs.location
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${lat}&longitude=${lon}` +
          `&hourly=uv_index,temperature_2m` +
          `&timezone=auto&forecast_days=7`
        )
        const raw = await res.json()
        const times: string[]  = raw.hourly.time
        const uvs:   number[]  = raw.hourly.uv_index
        const temps: number[]  = raw.hourly.temperature_2m

        const byDate: Record<string, { hour: number; uv: number; tempF: number }[]> = {}
        times.forEach((t, i) => {
          const [dateStr, timeStr] = t.split('T')
          const hour = parseInt(timeStr.split(':')[0])
          if (hour < 6 || hour > 20) return
          if (!byDate[dateStr]) byDate[dateStr] = []
          byDate[dateStr].push({
            hour,
            uv:    Math.round(uvs[i] * 10) / 10,
            tempF: Math.round(temps[i] * 9 / 5 + 32),
          })
        })

        const today = new Date()
        const result: DayForecast[] = Object.entries(byDate).slice(0, 7).map(([dateStr, hourly]) => {
          const d = new Date(dateStr + 'T12:00:00')
          const diffDays = Math.round((d.getTime() - today.setHours(0,0,0,0)) / 86400000)
          const label = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
          const shortLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' })
          return { dateStr, label, shortLabel, hourly }
        })

        setDays(result)
      } catch {
        setError('Could not load 7-day forecast.')
      } finally {
        setLoading(false)
      }
    }
    fetch7Day()
  }, [prefs.location.lat, prefs.location.lon])

  if (!prefs.activities.length) {
    return (
      <div style={{ padding: '3rem 0', textAlign: 'center' }}>
        <p style={{ fontSize: '32px', marginBottom: '10px' }}>🗓️</p>
        <p style={{ fontWeight: 500, color: 'var(--text)', marginBottom: '6px' }}>No activities set up yet</p>
        <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>
          Add activities in Preferences to see your 7-day safe window calendar.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem 0', textAlign: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>Loading 7-day forecast...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '2rem 0', textAlign: 'center' }}>
        <p style={{ fontSize: '13px', color: '#DC2626' }}>{error}</p>
      </div>
    )
  }

  const ACTIVITY_COLORS = [
    '#F97316', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899',
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
          7-day safe windows — {prefs.location.city}
        </p>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
          Tap a window to add to Google Calendar
        </p>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {prefs.activities.map((a, i) => (
          <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-2)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
            {a.icon} {a.name}
          </span>
        ))}
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: `${days.length * 120 + 48}px` }}>

          <div style={{ display: 'flex', marginLeft: '48px', gap: '4px', marginBottom: '4px' }}>
            {days.map(day => (
              <div key={day.dateStr} style={{ flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 500, color: day.shortLabel === 'Today' ? 'var(--accent)' : 'var(--text-2)' }}>
                {day.shortLabel}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <div style={{ width: '48px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: '4px' }}>
              {HOURS.filter((_, i) => i % 3 === 0).map(h => (
                <span key={h} style={{ fontSize: '10px', color: 'var(--text-3)', textAlign: 'right', paddingRight: '6px', height: `${100 / 5}%` }}>
                  {fmtH(h)}
                </span>
              ))}
            </div>

            {days.map(day => {
              const dayWindows = prefs.activities.map((act, i) => ({
                act,
                color: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length],
                windows: getSafeWindows(day.hourly, act.maxUV),
              }))

              const uvMap: Record<number, number> = {}
              day.hourly.forEach(h => { uvMap[h.hour] = h.uv })

              return (
                <div key={day.dateStr} style={{ flex: 1, position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '0.5px solid var(--border-md)' }}>
                  {HOURS.map(h => (
                    <div key={h} style={{
                      height: '28px',
                      background: uvBg(uvMap[h] ?? 0),
                      borderBottom: '0.5px solid rgba(0,0,0,0.04)',
                      position: 'relative',
                    }} />
                  ))}

                  {dayWindows.map(({ act, color, windows }) =>
                    windows.map((win, wi) => {
                      const topHour  = Math.max(win.from, 6)
                      const botHour  = Math.min(win.to,   20)
                      const topPct   = ((topHour - 6) / 14) * 100
                      const heightPct = ((botHour - topHour) / 14) * 100
                      const isHov = hovered?.day === day.dateStr && hovered?.act === act.id && hovered?.win === win
                      const idx   = prefs.activities.findIndex(a => a.id === act.id)
                      const left  = `${(idx / prefs.activities.length) * 80 + 4}%`
                      const width = `${(1 / prefs.activities.length) * 80}%`

                      return (
                        <div
                          key={`${act.id}-${wi}`}
                          onMouseEnter={() => setHovered({ day: day.dateStr, act: act.id, win })}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => calOk && window.open(gcalWindowLink(act, win, day.dateStr), '_blank')}
                          title={calOk ? `${act.name}: ${fmtH(win.from)}–${fmtH(win.to)} — click to add to Calendar` : 'Sign in for calendar sync'}
                          style={{
                            position: 'absolute',
                            top:    `${topPct}%`,
                            height: `${heightPct}%`,
                            left, width,
                            background: color,
                            opacity: isHov ? 0.9 : 0.55,
                            borderRadius: '4px',
                            cursor: calOk ? 'pointer' : 'default',
                            transition: 'opacity 0.1s',
                            display: 'flex',
                            alignItems: 'flex-start',
                            padding: '2px 3px',
                            overflow: 'hidden',
                            zIndex: isHov ? 10 : 1,
                          }}
                        >
                          <span style={{ fontSize: '9px', color: '#fff', fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                            {act.icon}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', marginLeft: '48px', gap: '4px', marginTop: '4px' }}>
            {days.map(day => (
              <div key={day.dateStr} style={{ flex: 1, textAlign: 'center', fontSize: '10px', color: 'var(--text-3)' }}>
                {new Date(day.dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hovered && (() => {
        const act = prefs.activities.find(a => a.id === hovered.act)
        if (!act) return null
        const win = hovered.win
        const day = days.find(d => d.dateStr === hovered.day)
        return (
          <div style={{
            marginTop: '12px', padding: '12px 16px', borderRadius: '12px',
            background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
          }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                {act.icon} {act.name} — {day?.shortLabel}
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
                Safe {fmtH(win.from)} to {fmtH(win.to)} · UV peaks at {win.peakUV.toFixed(1)} · Your {act.durationMins < 60 ? act.durationMins + 'min' : act.durationMins / 60 + 'hr'} session fits anywhere in this window
              </p>
            </div>
            {calOk ? (
              <button
                className="btn btn-primary"
                onClick={() => window.open(gcalWindowLink(act, win, hovered.day), '_blank')}
                style={{ fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                📅 Add window to Calendar
              </button>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>🔒 Sign in to add to Calendar</span>
            )}
          </div>
        )
      })()}

      <div style={{ marginTop: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[['rgba(134,239,172,0.5)', 'Low UV (0–2)'], ['rgba(252,211,77,0.5)', 'Moderate (3–5)'], ['rgba(251,146,60,0.5)', 'High (6–7)'], ['rgba(248,113,113,0.5)', 'Very high (8+)']].map(([bg, label]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-3)' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: bg, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
