'use client'
import { DayWeather, Activity, SkinType } from '@/lib/types'
import { planUpcomingSlots, UpcomingSlot } from '@/lib/planner'
import { BusyInterval, SlotRecommendation } from '@/lib/scheduler'
import { fmtClock } from '@/lib/weather'

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
}

function uvTone(uv: number): string {
  if (uv <= 2) return '#16A34A'
  if (uv <= 5) return '#D97706'
  if (uv <= 7) return '#EA580C'
  return '#DC2626'
}

/**
 * "Best day AND time this week" — for each activity, the best upcoming day and a
 * concrete recommended slot across the forecast horizon, scheduled around the
 * calendar when connected. Hidden when there are no activities or only today is
 * visible (it would just echo the activity cards).
 */
export default function PlanAhead({
  forecast, activities, skinType, dayLimit, busyByDate = {}, nowHourToday = -1,
  lockedDays, upgradeCopy, onUpgrade, onBook,
}: Props) {
  if (!activities.length || dayLimit <= 1) return null

  const plan = planUpcomingSlots(forecast, activities, skinType, dayLimit, busyByDate, nowHourToday)
  if (!plan.length) return null

  return (
    <div className="card">
      <div style={{ marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>Plan ahead</p>
        <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-3)' }}>
          Your best upcoming day and time for each activity.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {plan.map(({ activity, label, dateStr, slot }: UpcomingSlot) => (
          <div
            key={activity.id}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 12px', borderRadius: '10px',
              background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)',
            }}
          >
            <span style={{ fontSize: '20px', flexShrink: 0 }}>{activity.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activity.name}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
                {label} · {fmtClock(slot.start)}–{fmtClock(slot.end)}
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 750, color: uvTone(slot.avgUV) }}>
                {slot.windowLabel}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
                avg UV {slot.avgUV.toFixed(1)}
              </p>
            </div>
            {onBook && (
              <button
                className="btn"
                onClick={() => onBook(activity, slot, dateStr)}
                style={{ flexShrink: 0, fontSize: '11px', padding: '6px 10px' }}
              >
                📅 Book
              </button>
            )}
          </div>
        ))}
      </div>

      {upgradeCopy && lockedDays > 0 && (
        <button
          onClick={onUpgrade}
          className="btn"
          style={{ marginTop: '12px', width: '100%', justifyContent: 'center', fontSize: '12px', color: 'var(--accent)', borderColor: 'rgba(249,115,22,0.4)' }}
        >
          🔒 {upgradeCopy} — see {lockedDays} more day{lockedDays === 1 ? '' : 's'} of plans
        </button>
      )}
    </div>
  )
}
