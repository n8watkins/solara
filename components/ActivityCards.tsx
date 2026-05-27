'use client'

import { ActivityWindow } from '@/lib/types'
import { fmtHour, gcalLink } from '@/lib/weather'

interface Props {
  windows: ActivityWindow[]
  daysFromNow: number
}

export default function ActivityCards({ windows, daysFromNow }: Props) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">Activities</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {windows.map(({ activity, bestWindow, safeNow, pctDaySafe, burnMins }) => {
          const status = safeNow ? 'safe' : bestWindow ? 'caution' : 'avoid'
          return (
            <div key={activity.id} className="card flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{activity.icon}</span>
                <span className="text-sm font-medium text-gray-900 flex-1">{activity.name}</span>
                <span className={`badge ${
                  status === 'safe' ? 'badge-safe' : status === 'caution' ? 'badge-caution' : 'badge-avoid'
                }`}>
                  {status === 'safe' ? 'Safe now' : status === 'caution' ? 'Window later' : 'Avoid today'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Max safe UV</span>
                  <span className="font-medium text-gray-900">{activity.maxUV}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration</span>
                  <span className="font-medium text-gray-900">
                    {activity.durationMins < 60
                      ? `${activity.durationMins} min`
                      : `${activity.durationMins / 60} hr`}
                  </span>
                </div>
                {burnMins && (
                  <div className="flex justify-between">
                    <span>Burn limit at max UV</span>
                    <span className="font-medium text-gray-900">~{burnMins} min</span>
                  </div>
                )}
                {bestWindow ? (
                  <div className="flex justify-between">
                    <span>Best window</span>
                    <span className="font-medium text-green-700">
                      {fmtHour(bestWindow.from)}–{fmtHour(bestWindow.to)}
                    </span>
                  </div>
                ) : (
                  <div className="text-red-500 font-medium">No safe window today</div>
                )}
              </div>

              <div className="space-y-1">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pctDaySafe}%`,
                      background: pctDaySafe >= 60 ? '#86EFAC' : pctDaySafe >= 30 ? '#FCD34D' : '#F87171',
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400">{pctDaySafe}% of the day is safe</p>
              </div>

              {bestWindow && (
                <button
                  className="btn w-full justify-center text-xs mt-auto"
                  onClick={() => window.open(gcalLink(activity.name, bestWindow, activity.durationMins, daysFromNow), '_blank')}
                >
                  📅 Add to Google Calendar
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
