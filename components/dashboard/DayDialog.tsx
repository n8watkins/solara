import { Check, Lock, RotateCw } from 'lucide-react'
import type { DayWeather } from '@/lib/types'
import type { DashboardAccess } from '@/lib/dashboard-view'
import ActivityModalShell from '../ActivityModalShell'

/** The day picker's "More days" dialog: every visible day of the forecast. */
export default function DayDialog({
  access,
  onSelectDay,
  onClose,
}: {
  access: Pick<DashboardAccess, 'visibleForecast' | 'selectedDay'>
  onSelectDay: (day: DayWeather | null) => void
  onClose: () => void
}) {
  const { visibleForecast, selectedDay } = access
  return (
    <ActivityModalShell
      title="Choose a day"
      description="Pick any day in your forecast."
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        {visibleForecast.map((day, i) => {
          const active = i === 0 ? !selectedDay : selectedDay?.dateStr === day.dateStr
          return (
            <button
              key={day.dateStr}
              onClick={() => onSelectDay(i === 0 ? null : day)}
              className={`flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-[15px] py-[13px] text-left text-[14px] font-semibold ${
                active
                  ? 'border-0 bg-accent text-accent-on'
                  : 'border-[0.5px] border-line-strong bg-surface-metric text-ink'
              }`}
            >
              <span>{day.label}</span>
              {active && <Check size={16} />}
            </button>
          )
        })}
      </div>
    </ActivityModalShell>
  )
}
