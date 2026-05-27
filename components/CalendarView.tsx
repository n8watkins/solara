'use client'
import { useEffect, useRef, useState } from 'react'
import { UserPreferences } from '@/lib/types'
import { canUseCalendar } from '@/lib/tiers'
import { DayForecast, SafeWindow, getSafeWindows, gcalWindowLink, fmtH } from '@/lib/calendar'

interface Props { prefs: UserPreferences }

const ROW_H    = 52  // px per hour
const GUTTER_W = 52  // px for time labels
const HOURS    = Array.from({ length: 15 }, (_, i) => i + 6) // 6am–8pm

const ACT_COLORS = ['#F97316','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EC4899','#06B6D4','#84CC16']

function uvRowBg(uv: number, dark: boolean): string {
  const a = dark ? 0.18 : 0.12
  if (uv < 0.5) return `rgba(156,163,175,${a * 0.4})`
  if (uv <= 2)  return `rgba(74,222,128,${a})`
  if (uv <= 5)  return `rgba(250,204,21,${a})`
  if (uv <= 7)  return `rgba(251,146,60,${a})`
  if (uv <= 10) return `rgba(248,113,113,${a})`
  return `rgba(192,132,252,${a})`
}

export default function CalendarView({ prefs }: Props) {
  const [days,    setDays]    = useState<DayForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [popup,   setPopup]   = useState<{ act: typeof prefs.activities[0]; win: SafeWindow; day: DayForecast } | null>(null)
  const [dark,    setDark]    = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const tier  = prefs.tier || 'anonymous'
  const calOk = canUseCalendar(tier)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      const nowOffset = (new Date().getHours() - 6) * ROW_H - 80
      scrollRef.current.scrollTop = Math.max(0, nowOffset)
    }
  }, [days])

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null)
      try {
        const { lat, lon } = prefs.location
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&hourly=uv_index,temperature_2m&timezone=auto&forecast_days=7`
        )
        const raw = await res.json()
        const times: string[] = raw.hourly.time
        const uvs:   number[] = raw.hourly.uv_index
        const temps: number[] = raw.hourly.temperature_2m

        const byDate: Record<string, { hour: number; uv: number; tempF: number }[]> = {}
        times.forEach((t, i) => {
          const [d, tm] = t.split('T')
          const hour    = parseInt(tm)
          if (hour < 6 || hour > 20) return
          if (!byDate[d]) byDate[d] = []
          byDate[d].push({ hour, uv: Math.round(uvs[i] * 10) / 10, tempF: Math.round(temps[i] * 9 / 5 + 32) })
        })

        const now = new Date(); now.setHours(0,0,0,0)
        const result = Object.entries(byDate).slice(0, 7).map(([dateStr, hourly]) => {
          const d = new Date(dateStr + 'T12:00:00')
          const diff = Math.round((d.getTime() - now.getTime()) / 86400000)
          return {
            dateStr, hourly,
            label:      diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
            shortLabel: diff === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
          }
        })
        setDays(result)
      } catch { setError('Could not load forecast.') }
      finally   { setLoading(false) }
    }
    load()
  }, [prefs.location.lat, prefs.location.lon])

  if (!prefs.activities.length) return (
    <div style={{ padding: '3rem 0', textAlign: 'center' }}>
      <p style={{ fontSize: '32px', marginBottom: '10px' }}>🗓️</p>
      <p style={{ fontWeight: 500, color: 'var(--text)', marginBottom: '6px' }}>No activities yet</p>
      <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>Add activities in Preferences to see your weekly safe windows.</p>
    </div>
  )

  if (loading) return <div style={{ padding: '3rem 0', textAlign: 'center', fontSize: '13px', color: 'var(--text-3)' }}>Loading 7-day forecast…</div>
  if (error)   return <div style={{ padding: '2rem 0', textAlign: 'center', fontSize: '13px', color: '#DC2626' }}>{error}</div>

  const nowH = new Date().getHours()
  const nowM = new Date().getMinutes()
  const todayStr = new Date().toISOString().split('T')[0]

  const grid = dark
    ? { bg: '#161616', line: 'rgba(255,255,255,0.05)', lineMid: 'rgba(255,255,255,0.03)', headerBg: '#1C1C1C', todayBg: 'rgba(249,115,22,0.06)', text: '#6B6050', col: '#E5DDD0' }
    : { bg: '#FAFAF9', line: 'rgba(0,0,0,0.06)',       lineMid: 'rgba(0,0,0,0.03)',       headerBg: '#FFFFFF',  todayBg: 'rgba(249,115,22,0.05)', text: '#9C8B72', col: '#1A1208' }

  return (
    <div style={{ fontFamily: 'var(--font-sans)', borderRadius: '12px', overflow: 'hidden', border: `0.5px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>

      <div style={{ display: 'flex', background: grid.headerBg, borderBottom: `1px solid ${grid.line}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ width: GUTTER_W, flexShrink: 0 }} />
        {days.map(day => {
          const isToday = day.dateStr === todayStr
          const d = new Date(day.dateStr + 'T12:00:00')
          return (
            <div key={day.dateStr} style={{ flex: 1, padding: '10px 8px 8px', textAlign: 'center', borderLeft: `0.5px solid ${grid.line}`, background: isToday ? grid.todayBg : 'transparent' }}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 500, color: isToday ? 'var(--accent)' : grid.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {day.shortLabel}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 600, color: isToday ? 'var(--accent)' : grid.col, lineHeight: 1 }}>
                {d.getDate()}
              </p>
            </div>
          )
        })}
      </div>

      <div ref={scrollRef} style={{ height: '520px', overflowY: 'auto', overflowX: 'hidden', background: grid.bg }}>
        <div style={{ display: 'flex', position: 'relative', minHeight: `${ROW_H * HOURS.length}px` }}>

          <div style={{ width: GUTTER_W, flexShrink: 0, position: 'relative', zIndex: 5 }}>
            {HOURS.map((h, i) => (
              <div key={h} style={{ position: 'absolute', top: `${i * ROW_H - 8}px`, width: '100%', paddingRight: '8px', textAlign: 'right' }}>
                {i > 0 && <span style={{ fontSize: '11px', color: grid.text, fontWeight: 400 }}>{fmtH(h)}</span>}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
            {HOURS.map((h, i) => (
              <div key={h} style={{
                position: 'absolute', top: `${i * ROW_H}px`, left: 0, right: 0, height: `${ROW_H}px`,
                borderTop: `1px solid ${grid.line}`,
                zIndex: 0,
              }}>
                <div style={{ position: 'absolute', top: `${ROW_H / 2}px`, left: 0, right: 0, height: '0.5px', background: grid.lineMid }} />
              </div>
            ))}

            {days.map((day, di) => {
              const isToday = day.dateStr === todayStr
              const uvMap: Record<number, number> = {}
              day.hourly.forEach(h => { uvMap[h.hour] = h.uv })

              const wins = prefs.activities.map((act, ai) => ({
                act, color: ACT_COLORS[ai % ACT_COLORS.length],
                windows: getSafeWindows(day.hourly, act.maxUV),
              }))

              return (
                <div key={day.dateStr} style={{
                  flex: 1, position: 'relative',
                  borderLeft: `0.5px solid ${grid.line}`,
                  background: isToday ? grid.todayBg : 'transparent',
                  minWidth: 0,
                }}>
                  {HOURS.map((h, hi) => {
                    const uv = uvMap[h] ?? 0
                    return (
                      <div key={h} style={{
                        position: 'absolute', top: `${hi * ROW_H}px`, left: 0, right: 0, height: `${ROW_H}px`,
                        background: uvRowBg(uv, dark),
                        pointerEvents: 'none',
                      }} />
                    )
                  })}

                  {wins.map(({ act, color, windows }, wi) =>
                    windows.map((win, wii) => {
                      const topH    = Math.max(win.from, 6)
                      const botH    = Math.min(win.to, 20)
                      const top     = (topH - 6) * ROW_H
                      const height  = Math.max((botH - topH) * ROW_H - 2, 16)
                      const totalActs = prefs.activities.length
                      const colW    = 100 / totalActs
                      const left    = `${wi * colW + 1}%`
                      const width   = `${colW - 2}%`
                      const isHov   = popup?.act.id === act.id && popup?.win === win && popup?.day.dateStr === day.dateStr
                      const durationLabel = act.durationMins < 60 ? `${act.durationMins}m` : `${act.durationMins / 60}h`
                      const showText = height > 24

                      return (
                        <div
                          key={`${act.id}-${wii}`}
                          onClick={() => { setPopup(isHov ? null : { act, win, day }) }}
                          style={{
                            position: 'absolute', top: `${top + 1}px`, left, width, height: `${height}px`,
                            background: isHov ? color : `${color}CC`,
                            borderRadius: '5px',
                            cursor: 'pointer',
                            zIndex: isHov ? 15 : 5,
                            border: isHov ? `1.5px solid ${color}` : `1px solid ${color}99`,
                            padding: '3px 5px',
                            overflow: 'hidden',
                            transition: 'all 0.1s',
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
                            boxShadow: isHov ? `0 2px 8px ${color}44` : 'none',
                          }}
                        >
                          <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600, lineHeight: 1.2, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {act.icon} {showText ? act.name : ''}
                          </span>
                          {showText && height > 42 && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.2 }}>
                              {fmtH(win.from)}–{fmtH(win.to)}
                            </span>
                          )}
                          {showText && height > 58 && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
                              {durationLabel} session
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}

                  {isToday && nowH >= 6 && nowH <= 20 && (
                    <div style={{
                      position: 'absolute',
                      top: `${(nowH - 6) * ROW_H + (nowM / 60) * ROW_H}px`,
                      left: 0, right: 0, height: '2px',
                      background: 'var(--accent)',
                      zIndex: 20,
                    }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', position: 'absolute', left: '-4px', top: '-3px' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {popup && (
        <div style={{
          padding: '14px 16px', borderTop: `1px solid ${grid.line}`,
          background: grid.headerBg,
          display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <p style={{ margin: '0 0 3px', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
              {popup.act.icon} {popup.act.name}
              <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: '6px', fontSize: '13px' }}>
                {popup.day.label}
              </span>
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.5 }}>
              Safe window: <strong style={{ color: 'var(--text)' }}>{fmtH(popup.win.from)} – {fmtH(popup.win.to)}</strong>
              &nbsp;·&nbsp; Peak UV {popup.win.peakUV.toFixed(1)}
              &nbsp;·&nbsp; Schedule your{' '}
              <strong style={{ color: 'var(--text)' }}>
                {popup.act.durationMins < 60 ? popup.act.durationMins + 'min' : popup.act.durationMins / 60 + 'hr'}
              </strong>{' '}
              anywhere in this range
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
            {calOk ? (
              <button
                className="btn btn-primary"
                onClick={() => window.open(gcalWindowLink(popup.act, popup.win, popup.day.dateStr), '_blank')}
                style={{ fontSize: '13px', whiteSpace: 'nowrap' }}
              >
                📅 Add to Calendar
              </button>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>🔒 Sign in to add to Calendar</p>
            )}
            <button className="btn" onClick={() => setPopup(null)} style={{ fontSize: '13px' }}>✕</button>
          </div>
        </div>
      )}

      <div style={{ padding: '10px 16px', borderTop: `0.5px solid ${grid.line}`, background: grid.headerBg, display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {prefs.activities.map((a, i) => (
            <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-2)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: ACT_COLORS[i % ACT_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
              {a.icon} {a.name}
            </span>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[['rgba(74,222,128,0.4)','Low UV'],['rgba(250,204,21,0.4)','Moderate'],['rgba(251,146,60,0.4)','High'],['rgba(248,113,113,0.4)','Very high']].map(([bg, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-3)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: bg, display: 'inline-block' }} />
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
