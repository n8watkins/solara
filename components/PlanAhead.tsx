'use client'
import { CalendarPlus, Download, Lock } from 'lucide-react'
import type { DayWeather, Activity, SkinType } from '@/lib/types'
import type { UpcomingSlot } from '@/lib/planner'
import { planUpcomingSlots } from '@/lib/planner'
import type { BusyInterval, SlotRecommendation } from '@/lib/scheduler'
import { formatUV, uvBand, uvLabel } from '@/lib/weather'
import type * as IcsCode from '@/lib/ics'
import { useUnits } from '@/lib/use-units'
import { UV_BG } from './dashboard/uv-classes'

interface Props {
  forecast: DayWeather[]
  activities: Activity[]
  skinType: SkinType
  dayLimit: number
  busyByDate?: Record<string, BusyInterval[]>
  nowHourToday?: number
  lockedDays: number
  upgradeCopy: string | null
  onUpgrade?: () => void
  /** When provided (calendar connected), books the slot on its specific day. */
  onBook?: (activity: Activity, rec: SlotRecommendation, dateStr: string) => void
  /** Offers the .ics download (calendar export is part of Pro). */
  canExport?: boolean
}

/**
 * "Best day AND time this week": for each activity, the best upcoming day and a
 * concrete recommended slot across the forecast horizon, scheduled around the
 * calendar when connected. Hidden when there are no activities or only today is
 * visible (it would just echo the activity cards).
 */
export default function PlanAhead({
  forecast,
  activities,
  skinType,
  dayLimit,
  busyByDate = {},
  nowHourToday = -1,
  lockedDays,
  upgradeCopy,
  onUpgrade,
  onBook,
  canExport = true,
}: Props) {
  const fmt = useUnits()
  if (!activities.length || dayLimit <= 1) return null

  const plan = planUpcomingSlots(forecast, activities, skinType, dayLimit, busyByDate, nowHourToday)
  if (!plan.length) return null

  async function exportIcs() {
    // The calendar file code loads on the first export (and in the background soon
    // after the page loads, components/deferred.tsx).
    let ics: typeof IcsCode
    try {
      ics = await import('@/lib/ics')
    } catch (error) {
      console.error('Could not load the calendar export:', error)
      return
    }
    const { buildICS, recToIcsEvent, downloadICS } = ics
    const events = plan.map(({ activity, dateStr, slot }) => recToIcsEvent(activity, dateStr, slot))
    downloadICS('solara-sun-plan.ics', buildICS(events))
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-ink">Best day this week</p>
          <p className="mt-[3px] text-[13px] text-ink-3">
            The best upcoming day and time for each activity.
          </p>
        </div>
        {canExport && (
          <button
            className="btn shrink-0 text-[12px] whitespace-nowrap"
            onClick={() => void exportIcs()}
            title="Download all recommended slots as a calendar file (.ics) for any calendar app"
          >
            <Download size={14} /> Export .ics
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {plan.map(({ activity, label, dateStr, slot }: UpcomingSlot) => (
          <div
            key={activity.id}
            data-testid="plan-ahead-row"
            data-activity={activity.id}
            data-date={dateStr}
            data-start={slot.start}
            data-end={slot.end}
            className="flex items-center gap-3 rounded-[10px] border-[0.5px] border-line-strong bg-surface-metric px-3 py-2.5"
          >
            <span className="shrink-0 text-[20px]">{activity.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{activity.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {label} · {fmt.time(slot.start)}–{fmt.time(slot.end)}
              </p>
            </div>
            {/* Color means one thing here: the slot's average UV, on the same scale
                as the hourly strip. The time-of-day label stays neutral. */}
            <div className="shrink-0 text-right">
              <p className="text-[12px] font-semibold text-ink-2">{slot.windowLabel}</p>
              <span
                title={`Average UV ${formatUV(slot.avgUV)}, ${uvLabel(slot.avgUV)}`}
                className={`mt-[3px] inline-block rounded-full px-[7px] py-0.5 text-[11px] font-[650] whitespace-nowrap text-uv-ink ${UV_BG[uvBand(slot.avgUV)]}`}
              >
                avg UV {formatUV(slot.avgUV)}
              </span>
            </div>
            {onBook && (
              <button
                className="btn shrink-0 px-2.5 py-1.5 text-[11px]"
                onClick={() => onBook(activity, slot, dateStr)}
              >
                <CalendarPlus size={14} /> Book
              </button>
            )}
          </div>
        ))}
      </div>

      {upgradeCopy && lockedDays > 0 && (
        <button
          onClick={onUpgrade}
          className="btn mt-3 w-full justify-center border-brand/40 text-[12px] text-accent"
        >
          <Lock size={14} /> {upgradeCopy}: see {lockedDays} more day{lockedDays === 1 ? '' : 's'}{' '}
          of plans
        </button>
      )}
    </div>
  )
}
