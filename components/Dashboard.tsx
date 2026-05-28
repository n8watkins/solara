'use client'
import { useState } from 'react'
import { WeatherResponse, UserPreferences, DayWeather } from '@/lib/types'
import { burnMins, vitDMins, uvLabel, getActivityWindow, fmtHour } from '@/lib/weather'
import { getFutureDays } from '@/lib/tiers'
import UVTimeline from './UVTimeline'
import ActivityCards from './ActivityCards'
import Tooltip from './Tooltip'
import TipCarousel from './TipCarousel'

interface Props {
  weather: WeatherResponse
  prefs: UserPreferences
  onRefresh: () => void
  onAddActivities: () => void
  selectedDay: DayWeather | null
  onSelectDay: (day: DayWeather | null) => void
}

function uvNumberColor(uv: number): string {
  if (uv < 0.5) return 'var(--text-3)'
  if (uv <= 2)  return '#16A34A'
  if (uv <= 5)  return '#D97706'
  if (uv <= 7)  return '#EA580C'
  if (uv <= 10) return '#DC2626'
  return '#9333EA'
}

export default function Dashboard({ weather, prefs, onRefresh, onAddActivities, selectedDay, onSelectDay }: Props) {
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const currentHour = new Date().getHours()

  const tier = prefs.tier || 'anonymous'
  const accessibleDays = getFutureDays(tier)
  const visibleForecast = weather.forecast.slice(0, accessibleDays)
  const selectedDayAllowed = selectedDay && visibleForecast.some(day => day.dateStr === selectedDay.dateStr)
  const effectiveSelectedDay = selectedDayAllowed ? selectedDay : null

  const activeDayData = effectiveSelectedDay ? effectiveSelectedDay.hourly : weather.today
  const isToday       = !effectiveSelectedDay
  const dayIndex      = effectiveSelectedDay ? weather.forecast.findIndex(d => d.dateStr === effectiveSelectedDay.dateStr) : 0

  const hourly    = activeDayData
  const peakEntry = activeDayData.reduce((best, h) => h.uv > (best?.uv ?? 0) ? h : best, activeDayData[0])
  const currentUV   = isToday ? weather.current.uv    : (peakEntry?.uv    ?? 0)
  const currentTemp = isToday ? weather.current.tempF : (peakEntry?.tempF ?? '--' as string | number)
  const currentCond = isToday ? weather.current.condition : (peakEntry?.condition ?? '')
  const peakUV      = hourly.length ? Math.max(...hourly.map(h => h.uv)) : 0
  const peakHour    = hourly.find(h => h.uv === peakUV)?.hour ?? 12

  const burn = burnMins(currentUV, prefs.skinType)
  const vitD = vitDMins(currentUV, prefs.skinType)

  const activityWindows = prefs.activities.map(a => getActivityWindow(hourly, a, currentHour, prefs.skinType))
  const bestShareWindow = activityWindows.find(w => w.bestWindow)?.bestWindow
  const bestShareActivity = activityWindows.find(w => w.bestWindow)?.activity

  const dateLabel = effectiveSelectedDay?.label ?? 'Today'
  const lockedForecastCount = Math.max(0, weather.forecast.length - visibleForecast.length)
  const upgradeCopy = tier === 'anonymous'
    ? 'Sign in to see tomorrow'
    : tier === 'free'
    ? 'Go Pro for 10-day planning'
    : null

  async function shareSunWindow() {
    const place = `${prefs.location.city}${prefs.location.region ? `, ${prefs.location.region}` : ''}`
    const text = bestShareWindow && bestShareActivity
      ? `${dateLabel} in ${place}: Solara says my best ${bestShareActivity.name.toLowerCase()} window is ${fmtHour(bestShareWindow.from)}–${fmtHour(bestShareWindow.to)}. Peak UV ${peakUV.toFixed(1)}.`
      : `${dateLabel} in ${place}: Peak UV is ${peakUV.toFixed(1)} around ${fmtHour(peakHour)}. Checking my sun window with Solara.`
    const shareData = {
      title: 'My Solara sun window',
      text,
      url: typeof window !== 'undefined' ? window.location.origin : undefined,
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
        setShareMsg('Shared.')
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${shareData.url ?? ''}`.trim())
        setShareMsg('Copied share text.')
      } else {
        setShareMsg(text)
      }
    } catch {
      setShareMsg(null)
    }
    window.setTimeout(() => setShareMsg(null), 3500)
  }

  if (!hourly.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: '34px', marginBottom: '8px' }}>🌙</p>
        <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px', fontSize: '16px' }}>No UV data for this period</p>
        <p style={{ fontSize: '14px', color: 'var(--text-3)' }}>UV data is available between 6am and 8pm.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', WebkitOverflowScrolling: 'touch' as any }}>
            {visibleForecast.map((day, i) => {
              const isActive = effectiveSelectedDay ? effectiveSelectedDay.dateStr === day.dateStr : i === 0
              return (
                <button key={day.dateStr} onClick={() => onSelectDay(i === 0 ? null : day)} style={{
                  flexShrink: 0, padding: '8px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  background: isActive ? 'var(--accent)' : 'var(--bg-metric)',
                  color: isActive ? '#fff' : 'var(--text)',
                  border: 'none', transition: 'all 0.12s',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}>
                  {day.label}
                </button>
              )
            })}
            {upgradeCopy && lockedForecastCount > 0 && (
              <button
                onClick={() => setShareMsg(upgradeCopy)}
                style={{
                  flexShrink: 0,
                  padding: '8px 14px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '0.5px dashed rgba(249,115,22,0.55)',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}
              >
                🔒 {upgradeCopy}
              </button>
            )}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onRefresh} title="Refresh" style={{ padding: '7px 9px', fontSize: '17px', flexShrink: 0 }}>↻</button>
      </div>

      <TipCarousel />

      {shareMsg && (
        <div style={{ padding: '11px 13px', borderRadius: '10px', background: 'rgba(249,115,22,0.08)', color: 'var(--text-2)', fontSize: '13px', border: '0.5px solid rgba(249,115,22,0.2)' }}>
          {shareMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
        <div className="metric-card">
          <p style={{ margin: '0 0 5px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
            <span className="tooltip-anchor">
              UV index
              <Tooltip text="The UV Index measures solar radiation intensity. 0–2 is low risk, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme.">
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 700, color: uvNumberColor(currentUV), lineHeight: 1 }}>{currentUV.toFixed(1)}</p>
          <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>{uvLabel(currentUV)}</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 5px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>Temperature</p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{currentTemp}°F</p>
          <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>{currentCond}</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 5px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
            <span className="tooltip-anchor">
              Burn time
              <Tooltip text={`How long until ${prefs.skinType} skin burns without sunscreen at the current UV level. Move to shade before this time is up.`}>
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{burn ? `${burn}m` : '—'}</p>
          <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>{prefs.skinType} skin, no SPF</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 5px', fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
            <span className="tooltip-anchor">
              Vitamin D dose
              <Tooltip text="Estimated time to produce a meaningful vitamin D dose at the current UV level, with arms and legs exposed. Varies by skin type.">
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '32px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{vitD ? `${vitD}m` : '—'}</p>
          <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>Arms + legs</p>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '8px', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>
            <Tooltip text="Each bar shows the UV index for that hour. Hover or tap to see burn time and conditions. The 'now' marker shows the current hour.">
              UV by hour
            </Tooltip>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>Peak {peakUV.toFixed(1)} at {fmtHour(peakHour)}</p>
            <button className="btn" onClick={shareSunWindow} style={{ fontSize: '13px', padding: '6px 11px' }}>↗ Share</button>
          </div>
        </div>
        <UVTimeline hourly={hourly} currentHour={isToday ? currentHour : -1} skinType={prefs.skinType} />
      </div>

      {prefs.activities.length > 0 ? (
        <ActivityCards windows={activityWindows} daysFromNow={dayIndex} tier={tier} />
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '2.75rem 1.5rem' }}>
          <p style={{ fontSize: '30px', marginBottom: '10px' }}>🏃</p>
          <p style={{ fontWeight: 650, fontSize: '16px', color: 'var(--text)', margin: '0 0 7px' }}>No activities set up yet</p>
          <p style={{ fontSize: '14px', color: 'var(--text-3)', margin: '0 0 20px', lineHeight: '1.55' }}>
            Add the activities you do outside and we'll show you exactly when it's safe to go.
          </p>
          <button className="btn btn-primary" onClick={onAddActivities} style={{ fontSize: '14px', padding: '10px 24px', borderRadius: '12px' }}>
            + Add activities
          </button>
        </div>
      )}

    </div>
  )
}
