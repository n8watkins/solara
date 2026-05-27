'use client'

import { useState } from 'react'
import { WeatherResponse, UserPreferences } from '@/lib/types'
import { burnMins, vitDMins, uvLabel, getActivityWindow, fmtHour } from '@/lib/weather'
import UVTimeline from './UVTimeline'
import ActivityCards from './ActivityCards'

interface Props {
  weather: WeatherResponse
  prefs: UserPreferences
  onRefresh: () => void
}

function uvNumberColor(uv: number): string {
  if (uv < 0.5) return '#6B7280'
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

  const currentUV        = day === 'today' ? weather.current.uv : (hourly[0]?.uv ?? 0)
  const currentTemp      = day === 'today' ? weather.current.tempF : (hourly[0]?.tempF ?? '--')
  const currentCondition = day === 'today' ? weather.current.condition : (hourly[0]?.condition ?? '')
  const peakUV   = hourly.length ? Math.max(...hourly.map(h => h.uv)) : 0
  const peakHour = hourly.find(h => h.uv === peakUV)?.hour ?? 12

  const burn = burnMins(currentUV, prefs.skinType)
  const vitD = vitDMins(currentUV, prefs.skinType)

  const activityWindows = prefs.activities.map(a =>
    getActivityWindow(hourly, a, currentHour)
  )

  const dateLabel = day === 'today'
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  const vitDPeak = vitDMins(peakUV, prefs.skinType)

  if (!hourly.length) {
    return (
      <div className="card text-center py-10">
        <p className="text-3xl mb-2">🌙</p>
        <p className="text-gray-600 text-sm font-medium">No UV data for this day</p>
        <p className="text-gray-400 text-xs mt-1">UV data is only available between 6am and 8pm.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {prefs.location.city}{prefs.location.region ? `, ${prefs.location.region}` : ''}
          </p>
          <p className="text-xs text-gray-400">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 p-1"
            onClick={onRefresh}
            title="Refresh weather data"
          >
            ↻
          </button>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(['today', 'tomorrow'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  day === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">UV index</p>
          <p className="text-2xl font-semibold" style={{ color: uvNumberColor(currentUV) }}>
            {currentUV.toFixed(1)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{uvLabel(currentUV)}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Temperature</p>
          <p className="text-2xl font-semibold text-gray-900">{currentTemp}°F</p>
          <p className="text-xs text-gray-500 mt-1">{currentCondition}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Burn time</p>
          <p className="text-2xl font-semibold text-gray-900">{burn ? `${burn}m` : '—'}</p>
          <p className="text-xs text-gray-500 mt-1">{prefs.skinType} skin, no SPF</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Vitamin D dose</p>
          <p className="text-2xl font-semibold text-gray-900">{vitD ? `${vitD}m` : '—'}</p>
          <p className="text-xs text-gray-500 mt-1">Arms + legs exposed</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700">UV by hour</p>
          <p className="text-xs text-gray-400">Peak {peakUV.toFixed(1)} at {fmtHour(peakHour)}</p>
        </div>
        <UVTimeline
          hourly={hourly}
          currentHour={day === 'today' ? currentHour : -1}
          skinType={prefs.skinType}
        />
      </div>

      <ActivityCards
        windows={activityWindows}
        daysFromNow={day === 'today' ? 0 : 1}
      />

      <div className="card bg-amber-50 border-amber-200">
        <p className="text-sm font-medium text-amber-900 mb-1">☀️ Vitamin D tip</p>
        <p className="text-sm text-amber-800 leading-relaxed">
          {vitDPeak && vitDPeak <= 30
            ? `At peak UV ${peakUV.toFixed(1)}, ${prefs.skinType} skin needs about ${vitDPeak} min of arm and leg exposure for a daily vitamin D dose. ${prefs.sunscreen ? 'Skip sunscreen for that short window only.' : 'Go out during a low-UV window and skip sunscreen for just those minutes.'}`
            : `UV is low today — vitamin D production is limited. Consider a supplement on overcast days.`
          }
        </p>
      </div>

    </div>
  )
}
