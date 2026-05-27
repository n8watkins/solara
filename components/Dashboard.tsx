'use client'
import { useState } from 'react'
import { WeatherResponse, UserPreferences } from '@/lib/types'
import { burnMins, vitDMins, uvLabel, getActivityWindow, fmtHour } from '@/lib/weather'
import { canUseCalendar } from '@/lib/tiers'
import UVTimeline from './UVTimeline'
import ActivityCards from './ActivityCards'
import Tooltip from './Tooltip'

interface Props {
  weather: WeatherResponse
  prefs: UserPreferences
  onRefresh: () => void
}

function uvNumberColor(uv: number): string {
  if (uv < 0.5) return 'var(--text-3)'
  if (uv <= 2)  return '#16A34A'
  if (uv <= 5)  return '#D97706'
  if (uv <= 7)  return '#EA580C'
  if (uv <= 10) return '#DC2626'
  return '#9333EA'
}

export default function Dashboard({ weather, prefs, onRefresh }: Props) {
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')
  const hourly      = day === 'today' ? weather.today : weather.tomorrow
  const currentHour = new Date().getHours()

  const currentUV   = day === 'today' ? weather.current.uv   : (hourly[0]?.uv    ?? 0)
  const currentTemp = day === 'today' ? weather.current.tempF : (hourly[0]?.tempF ?? '--')
  const currentCond = day === 'today' ? weather.current.condition : (hourly[0]?.condition ?? '')
  const peakUV      = hourly.length ? Math.max(...hourly.map(h => h.uv)) : 0
  const peakHour    = hourly.find(h => h.uv === peakUV)?.hour ?? 12

  const burn = burnMins(currentUV, prefs.skinType)
  const vitD = vitDMins(currentUV, prefs.skinType)

  const tier = prefs.tier || 'anonymous'
  const activityWindows = prefs.activities.map(a => getActivityWindow(hourly, a, currentHour))

  const dateLabel = day === 'today'
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  const vitDPeak = vitDMins(peakUV, prefs.skinType)

  if (!hourly.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: '32px', marginBottom: '8px' }}>🌙</p>
        <p style={{ fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>No UV data for this period</p>
        <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>UV data is available between 6am and 8pm.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-2)' }}>
            {prefs.location.city}{prefs.location.region ? `, ${prefs.location.region}` : ''}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>{dateLabel}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button className="btn btn-ghost" onClick={onRefresh} title="Refresh" style={{ padding: '6px 8px', fontSize: '16px' }}>↻</button>
          <div style={{ display: 'flex', background: 'var(--bg-metric)', borderRadius: '10px', padding: '3px' }}>
            {(['today', 'tomorrow'] as const).map(d => (
              <button key={d} onClick={() => setDay(d)} style={{
                padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                background: day === d ? 'var(--bg-card)' : 'transparent',
                color: day === d ? 'var(--text)' : 'var(--text-3)',
                border: day === d ? '0.5px solid var(--border-md)' : 'none',
                transition: 'all 0.15s',
              }}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
        <div className="metric-card">
          <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--text-3)' }}>
            <span className="tooltip-anchor">
              UV index
              <Tooltip text="The UV Index measures solar radiation intensity. 0–2 is low risk, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme.">
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: uvNumberColor(currentUV) }}>{currentUV.toFixed(1)}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>{uvLabel(currentUV)}</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--text-3)' }}>Temperature</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--text)' }}>{currentTemp}°F</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>{currentCond}</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--text-3)' }}>
            <span className="tooltip-anchor">
              Burn time
              <Tooltip text={`How long until ${prefs.skinType} skin burns without sunscreen at the current UV level. Move to shade before this time is up.`}>
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--text)' }}>{burn ? `${burn}m` : '—'}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>{prefs.skinType} skin, no SPF</p>
        </div>
        <div className="metric-card">
          <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--text-3)' }}>
            <span className="tooltip-anchor">
              Vitamin D dose
              <Tooltip text="Estimated time to produce a meaningful vitamin D dose at the current UV level, with arms and legs exposed. Varies by skin type.">
                <></>
              </Tooltip>
            </span>
          </p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 600, color: 'var(--text)' }}>{vitD ? `${vitD}m` : '—'}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>Arms + legs</p>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
            <Tooltip text="Each bar shows the UV index for that hour. Hover or tap to see burn time and conditions. The 'now' marker shows the current hour.">
              UV by hour
            </Tooltip>
          </p>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>Peak {peakUV.toFixed(1)} at {fmtHour(peakHour)}</p>
        </div>
        <UVTimeline hourly={hourly} currentHour={day === 'today' ? currentHour : -1} skinType={prefs.skinType} />
      </div>

      {prefs.activities.length > 0 ? (
        <ActivityCards windows={activityWindows} daysFromNow={day === 'today' ? 0 : 1} tier={tier} />
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ fontSize: '24px', marginBottom: '8px' }}>🏃</p>
          <p style={{ fontWeight: 500, color: 'var(--text)', margin: '0 0 4px' }}>No activities set up yet</p>
          <p style={{ fontSize: '13px', color: 'var(--text-3)', margin: '0 0 16px' }}>
            Add activities in Preferences to see personalized safe windows.
          </p>
        </div>
      )}

      <div className="card" style={{ background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.3)' }}>
        <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>☀️ Vitamin D tip</p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' }}>
          {vitDPeak && vitDPeak <= 30
            ? `At peak UV ${peakUV.toFixed(1)}, ${prefs.skinType} skin needs about ${vitDPeak} min with arms and legs exposed for a daily dose. ${prefs.sunscreen ? 'Skip sunscreen for that short window.' : 'Do it during a lower-UV window.'}`
            : 'UV is low today — vitamin D production is limited. Consider a supplement on overcast days.'
          }
        </p>
      </div>

    </div>
  )
}
