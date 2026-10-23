'use client'
import { useEffect, useRef, useState } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import { canUseCalendar, getFutureDays, TIER_LIMITS } from '@/lib/tiers'
import type { DayForecast, SafeWindow } from '@/lib/calendar'
import { getSafeWindowsForActivity, gcalWindowLink, fmtH } from '@/lib/calendar'
import { fetchForecast } from '@/lib/forecast'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import EditActivityModal from './EditActivityModal'

interface Props {
  prefs: UserPreferences
  weather?: WeatherResponse | null
  displayTier?: UserPreferences['tier']
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

const ROW_H    = 60
const GUTTER_W = 58

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

function forecastFromWeather(weather: WeatherResponse, limit = 7): DayForecast[] {
  const todayStr = new Date().toLocaleDateString('en-CA')
  return weather.forecast.slice(0, limit).map(day => {
    const d = new Date(day.dateStr + 'T12:00:00')
    return {
      dateStr: day.dateStr,
      label: day.label,
      shortLabel: day.dateStr === todayStr ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
      hourly: day.hourly.map(h => ({ hour: h.hour, uv: h.uv, tempF: h.tempF })),
    }
  })
}

export default function CalendarView({ prefs, weather, displayTier, onPrefsUpdate }: Props) {
  const tier  = displayTier || prefs.tier || 'anonymous'
  const dayLimit = getFutureDays(tier)
  const [days,    setDays]    = useState<DayForecast[]>(weather ? forecastFromWeather(weather, dayLimit) : [])
  const [loading, setLoading] = useState(!weather)
  const [error,   setError]   = useState<string | null>(null)
  const [popup,   setPopup]   = useState<{ act: Activity; win: SafeWindow; day: DayForecast } | null>(null)
  const [hrFrom,  setHrFrom]  = useState(prefs.calendarHours?.from ?? 6)
  const [hrTo,    setHrTo]    = useState(prefs.calendarHours?.to   ?? 20)
  const [dark,    setDark]    = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [focusedActivityId, setFocusedActivityId] = useState<string>('all')
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const calOk = canUseCalendar(tier)
  const visibleActivities = focusedActivityId === 'all'
    ? prefs.activities
    : prefs.activities.filter(a => a.id === focusedActivityId)
  const editingActivity = editingActivityId ? prefs.activities.find(a => a.id === editingActivityId) ?? null : null
  const lockedCopy = tier === 'anonymous'
    ? 'Sign in to see tomorrow in Calendar.'
    : tier === 'free'
    ? 'Go Pro for the full 10-day Calendar view.'
    : null

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      const nowOffset = (new Date().getHours() - hrFrom) * ROW_H - 120
      scrollRef.current.scrollTop = Math.max(0, nowOffset)
    }
  }, [days, hrFrom])

  useEffect(() => {
    if (weather) {
      setDays(forecastFromWeather(weather, dayLimit))
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    async function load() {
      setLoading(true); setError(null)
      try {
        const data = await fetchForecast(prefs.location, { days: dayLimit, signal: controller.signal })
        setDays(forecastFromWeather(data, dayLimit))
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setError('Could not load forecast.')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [prefs.location.lat, prefs.location.lon, weather, dayLimit])

  function openCalendar(act: Activity, win: SafeWindow, day: DayForecast) {
    const opened = window.open(gcalWindowLink(act, win, day.dateStr), '_blank')
    setConfirm(opened ? 'Opened Google Calendar.' : 'Pop-up blocked. Allow pop-ups or copy the calendar link.')
    window.setTimeout(() => setConfirm(null), 3500)
  }

  async function shareWindow(act: Activity, win: SafeWindow, day: DayForecast) {
    const payload = { activity: act, window: win, location: prefs.location, dateLabel: day.label }
    const text = buildActivityShareText(payload)
    const url = buildActivityShareUrl(payload, typeof window !== 'undefined' ? window.location.origin : undefined)
    try {
      const result = await shareOrCopy(`${act.name} sun window`, text, url)
      setConfirm(result === 'shared' ? 'Shared activity window.' : result === 'copied' ? 'Copied share text and link.' : `${text} ${url}`)
    } catch { setConfirm(null) }
    window.setTimeout(() => setConfirm(null), 4500)
  }

  function updateActivity(updated: Activity) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({ ...prefs, activities: prefs.activities.map(a => a.id === updated.id ? updated : a) })
    setEditingActivityId(null)
  }

  function deleteActivity(id: string) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({ ...prefs, activities: prefs.activities.filter(a => a.id !== id) })
    setEditingActivityId(null)
    setPopup(null)
  }

  function applyView(from: number, to: number) {
    setHrFrom(from)
    setHrTo(to)
  }

  if (!prefs.activities.length) return (
    <div style={{ padding: '3rem 0', textAlign: 'center' }}>
      <p style={{ fontSize: '34px', marginBottom: '10px' }}>🗓️</p>
      <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '6px', fontSize: '16px' }}>No activities yet</p>
      <p style={{ fontSize: '14px', color: 'var(--text-3)' }}>Add activities from the Dashboard to see estimated lower-UV windows.</p>
    </div>
  )

  if (loading) return <div style={{ padding: '3rem 0', textAlign: 'center', fontSize: '14px', color: 'var(--text-3)' }}>Loading forecast…</div>
  if (error)   return <div style={{ padding: '2rem 0', textAlign: 'center', fontSize: '14px', color: '#DC2626' }}>{error}</div>

  const HOURS = Array.from({ length: Math.max(1, hrTo - hrFrom + 1) }, (_, i) => i + hrFrom)
  const nowH = new Date().getHours()
  const nowM = new Date().getMinutes()
  const todayStr = new Date().toLocaleDateString('en-CA')

  const grid = dark
    ? { bg: '#161616', line: 'rgba(255,255,255,0.05)', lineMid: 'rgba(255,255,255,0.03)', headerBg: '#1C1C1C', todayBg: 'rgba(249,115,22,0.06)', text: '#6B6050', col: '#E5DDD0' }
    : { bg: '#FAFAF9', line: 'rgba(0,0,0,0.06)',       lineMid: 'rgba(0,0,0,0.03)',       headerBg: '#FFFFFF',  todayBg: 'rgba(249,115,22,0.05)', text: '#9C8B72', col: '#1A1208' }

  return (
    <div style={{ fontFamily: 'var(--font-sans)', borderRadius: '12px', overflow: 'hidden', border: `0.5px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
      <div style={{ padding: '12px 14px', background: grid.headerBg, borderBottom: `1px solid ${grid.line}`, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.055em' }}>Show</span>
        <select value={focusedActivityId} onChange={e => setFocusedActivityId(e.target.value)} style={{ fontSize: '12px', padding: '6px 8px' }}>
          <option value="all">All activities</option>
          {prefs.activities.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => applyView(6, 12)} style={{ fontSize: '12px', padding: '6px 9px' }}>Morning</button>
          <button className="btn" onClick={() => applyView(12, 18)} style={{ fontSize: '12px', padding: '6px 9px' }}>Afternoon</button>
          <button className="btn" onClick={() => applyView(16, 20)} style={{ fontSize: '12px', padding: '6px 9px' }}>Evening</button>
          <button className="btn" onClick={() => applyView(6, 20)} style={{ fontSize: '12px', padding: '6px 9px' }}>Full day</button>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-3)', marginLeft: 'auto' }}>
          Click a window to share, edit, or add it to Calendar.
        </span>
      </div>

      {lockedCopy && days.length > 0 && days.length < TIER_LIMITS.paid.futureDays && (
        <div style={{ padding: '10px 14px', background: 'rgba(249,115,22,0.08)', color: 'var(--text-2)', fontSize: '13px', borderBottom: `1px solid ${grid.line}` }}>
          🔒 {lockedCopy}
        </div>
      )}

      {confirm && (
        <div style={{ padding: '9px 14px', background: 'rgba(249,115,22,0.08)', color: 'var(--text-2)', fontSize: '12px', borderBottom: `1px solid ${grid.line}` }}>
          {confirm}
        </div>
      )}

      <div style={{ display: 'flex', background: grid.headerBg, borderBottom: `1px solid ${grid.line}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ width: GUTTER_W, flexShrink: 0 }} />
        {days.map(day => {
          const isToday = day.dateStr === todayStr
          const d = new Date(day.dateStr + 'T12:00:00')
          return (
            <div key={day.dateStr} style={{ flex: 1, padding: '10px 8px 8px', textAlign: 'center', borderLeft: `0.5px solid ${grid.line}`, background: isToday ? grid.todayBg : 'transparent', minWidth: '96px' }}>
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

      <div ref={scrollRef} style={{ height: '760px', overflowY: 'auto', overflowX: 'auto', background: grid.bg }}>
        <div style={{ display: 'flex', position: 'relative', minHeight: `${ROW_H * HOURS.length}px`, minWidth: `${GUTTER_W + days.length * 118}px` }}>

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

            {days.map(day => {
              const isToday = day.dateStr === todayStr
              const uvMap: Record<number, number> = {}
              day.hourly.forEach(h => { uvMap[h.hour] = h.uv })

              const wins = visibleActivities.map((act, ai) => ({
                act, color: ACT_COLORS[prefs.activities.findIndex(a => a.id === act.id) % ACT_COLORS.length] || ACT_COLORS[ai % ACT_COLORS.length],
                windows: getSafeWindowsForActivity(day.hourly, act),
              }))

              return (
                <div key={day.dateStr} style={{
                  flex: 1, position: 'relative',
                  borderLeft: `0.5px solid ${grid.line}`,
                  background: isToday ? grid.todayBg : 'transparent',
                  minWidth: '118px',
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
                      const topH    = Math.max(win.from, hrFrom)
                      const botH    = Math.min(win.to, hrTo)
                      if (botH <= topH) return null
                      const top     = (topH - hrFrom) * ROW_H
                      const height  = Math.max((botH - topH) * ROW_H - 2, 18)
                      const totalActs = visibleActivities.length || 1
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
                            borderRadius: '6px',
                            cursor: 'pointer',
                            zIndex: isHov ? 15 : 5,
                            border: isHov ? `1.5px solid ${color}` : `1px solid ${color}99`,
                            padding: '4px 6px',
                            overflow: 'hidden',
                            transition: 'all 0.1s',
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
                            boxShadow: isHov ? `0 2px 8px ${color}44` : 'none',
                          }}
                        >
                          <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700, lineHeight: 1.2, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {act.icon} {showText ? act.name : ''}
                          </span>
                          {showText && height > 42 && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.88)', lineHeight: 1.2 }}>
                              {fmtH(win.from)}–{fmtH(win.to)}
                            </span>
                          )}
                          {showText && height > 58 && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.76)' }}>
                              {durationLabel} session
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}

                  {isToday && nowH >= hrFrom && nowH <= hrTo && (
                    <div style={{
                      position: 'absolute',
                      top: `${(nowH - hrFrom) * ROW_H + (nowM / 60) * ROW_H}px`,
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
          <div style={{ flex: 1, minWidth: '220px' }}>
            <p style={{ margin: '0 0 3px', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
              {popup.act.icon} {popup.act.name}
              <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: '6px', fontSize: '13px' }}>
                {popup.day.label}
              </span>
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.5 }}>
              Estimated lower-UV window: <strong style={{ color: 'var(--text)' }}>{fmtH(popup.win.from)} – {fmtH(popup.win.to)}</strong>
              &nbsp;·&nbsp; Peak UV {popup.win.peakUV.toFixed(1)}
              &nbsp;·&nbsp; Schedule your{' '}
              <strong style={{ color: 'var(--text)' }}>
                {popup.act.durationMins < 60 ? popup.act.durationMins + 'min' : popup.act.durationMins / 60 + 'hr'}
              </strong>{' '}
              anywhere in this range
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => shareWindow(popup.act, popup.win, popup.day)} style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
              ↗ Share
            </button>
            {onPrefsUpdate && (
              <button className="btn" onClick={() => setEditingActivityId(popup.act.id)} style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
                Edit activity
              </button>
            )}
            {calOk ? (
              <button
                className="btn btn-primary"
                onClick={() => openCalendar(popup.act, popup.win, popup.day)}
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
          {[[ 'rgba(74,222,128,0.4)','Low UV'],['rgba(250,204,21,0.4)','Moderate'],['rgba(251,146,60,0.4)','High'],['rgba(248,113,113,0.4)','Very high']].map(([bg, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-3)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: bg, display: 'inline-block' }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      <p style={{ margin: 0, padding: '9px 16px', borderTop: `0.5px solid ${grid.line}`, background: grid.headerBg, fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.45 }}>
        Forecast-based planning estimate only. Recheck current UV and use appropriate sun protection.
      </p>

      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onSave={updateActivity}
          onDelete={deleteActivity}
          onClose={() => setEditingActivityId(null)}
        />
      )}
    </div>
  )
}
