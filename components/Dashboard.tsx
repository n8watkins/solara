'use client'

import { useState } from 'react'
import { WeatherResponse, UserPreferences } from '@/lib/types'
import { burnMins, vitDMins, uvLabel, getActivityWindow, fmtHour } from '@/lib/weather'
import UVTimeline from './UVTimeline'
import ActivityCards from './ActivityCards'

interface Props {
  weather: WeatherResponse
  prefs: UserPreferences
}

export default function Dashboard({ weather, prefs }: Props) {
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')
  const hourly = day === 'today' ? weather.today : weather.tomorrow
  const currentHour = new Date().getHours()

  const currentUV = day === 'today' ? weather.current.uv : hourly[0]?.uv ?? 0
  const currentTemp = day === 'today' ? weather.current.tempF : hourly[0]?.tempF ?? '--'
  const currentCondition = day === 'today' ? weather.current.condition : hourly[0]?.condition ?? ''
  const peakUV = Math.max(...hourly.map(h => h.uv))
  const peakHour = hourly.find(h => h.uv === peakUV)?.hour ?? 12

  const burn = burnMins(currentUV, prefs.skinType)
  const vitD = vitDMins(currentUV, prefs.skinType)

  const activityWindows = prefs.activities.map(a =>
    getActivityWindow(hourly, a, currentHour)
  )

  const dateLabel = day === 'today'
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="space-y-5">

      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{prefs.location.city}, {prefs.location.region}</p>
          <p className="text-xs text-gray-400">{dateLabel}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setDay('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              day === 'today' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDay('tomorrow')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              day === 'tomorrow' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Tomorrow
          </button>
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
          <p className="text-xs text-gray-500 mt-1">No SPF, {prefs.skinType} skin</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Vitamin D dose</p>
          <p className="text-2xl font-semibold text-gray-900">{vitD ? `${vitD}m` : '—'}</p>
          <p className="text-xs text-gray-500 mt-1">Arms + legs</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700">UV by hour</p>
          <p className="text-xs text-gray-400">Peak {peakUV} at {fmtHour(peakHour)}</p>
        </div>
        <UVTimeline hourly={hourly} currentHour={day === 'today' ? currentHour : -1} />
      </div>

      <ActivityCards
        windows={activityWindows}
        daysFromNow={day === 'today' ? 0 : 1}
      />

      <div className="card bg-amber-50 border-amber-200">
        <p className="text-sm font-medium text-amber-900 mb-1">☀️ Vitamin D tip</p>
        <p className="text-sm text-amber-800 leading-relaxed">
          {vitDMins(peakUV, prefs.skinType) && vitDMins(peakUV, prefs.skinType)! <= 30
            ? `At peak UV ${peakUV} today, ${prefs.skinType} skin needs about ${vitDMins(peakUV, prefs.skinType)} min of arm and leg exposure for a full daily dose. Skip sunscreen for that window only — then cover up or apply SPF.`
            : `UV is low today — vitamin D production is limited. You may want a supplement on days like this.`
          }
        </p>
      </div>

    </div>
  )
}

function uvNumberColor(uv: number): string {
  if (uv < 0.5) return '#6B7280'
  if (uv <= 2)  return '#16A34A'
  if (uv <= 5)  return '#D97706'
  if (uv <= 7)  return '#EA580C'
  if (uv <= 10) return '#DC2626'
  return '#9333EA'
}
