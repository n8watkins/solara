'use client'
import { DayWeather, Activity, SkinType } from '@/lib/types'
import { planUpcoming } from '@/lib/planner'
import { fmtHour } from '@/lib/weather'

interface Props {
  forecast: DayWeather[]
  activities: Activity[]
  skinType: SkinType
  dayLimit: number
  lockedDays: number
  upgradeCopy: string | null
  onUpgrade?: () => void
}

function uvTone(uv: number): string {
  if (uv <= 2) return '#16A34A'
  if (uv <= 5) return '#D97706'
  if (uv <= 7) return '#EA580C'
  return '#DC2626'
}

/**
 * "Best day this week for X" — for each activity, the single best upcoming safe
 * window across the accessible forecast horizon. Hidden when there are no
 * activities or only today is visible (it would just echo the activity cards).
 */
export default function PlanAhead({ forecast, activities, skinType, dayLimit, lockedDays, upgradeCopy, onUpgrade }: Props) {
  if (!activities.length || dayLimit <= 1) return null

  const plan = planUpcoming(forecast, activities, skinType, dayLimit)
  if (!plan.length) return null

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>Plan ahead</p>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--text-3)' }}>
            Your best upcoming window for each activity.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {plan.map(({ activity, label, window: win }) => (
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
                {label} · {fmtHour(win.from)}–{fmtHour(win.to)}
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 750, color: uvTone(win.avgUV) }}>
                {win.label}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
                avg UV {win.avgUV.toFixed(1)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {upgradeCopy && lockedDays > 0 && (
        <button
          onClick={onUpgrade}
          className="btn"
          style={{ marginTop: '12px', width: '100%', justifyContent: 'center', fontSize: '12px', color: 'var(--accent)', borderColor: 'rgba(249,115,22,0.4)' }}
        >
          🔒 {upgradeCopy} — see {lockedDays} more day{lockedDays === 1 ? '' : 's'} of windows
        </button>
      )}
    </div>
  )
}
