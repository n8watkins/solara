'use client'
import { ActivityWindow, TierLevel } from '@/lib/types'
import { fmtHour, gcalLink } from '@/lib/weather'
import { canUseCalendar } from '@/lib/tiers'

interface Props {
  windows: ActivityWindow[]
  daysFromNow: number
  tier: TierLevel
}

function Row({ label, val, accent }: { label: string; val: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: accent || 'var(--text)', fontWeight: 500 }}>{val}</span>
    </div>
  )
}

export default function ActivityCards({ windows, daysFromNow, tier }: Props) {
  const calendarAllowed = canUseCalendar(tier)

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>Activities</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
        {windows.map(({ activity, bestWindow, safeNow, pctDaySafe, burnMins }) => {
          const status = safeNow ? 'safe' : bestWindow ? 'caution' : 'avoid'
          const durationLabel = activity.durationMins < 60
            ? `${activity.durationMins}m`
            : `${activity.durationMins / 60}h`
          const windowLabel = bestWindow
            ? `${fmtHour(bestWindow.from)}–${fmtHour(bestWindow.to)}`
            : 'None today'

          return (
            <div key={activity.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>{activity.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', flex: 1 }}>{activity.name}</span>
                <span className={`badge badge-${status}`}>
                  {status === 'safe' ? 'Safe now' : status === 'caution' ? 'Later' : 'Avoid'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Row label="Max safe UV" val={String(activity.maxUV)} />
                <Row label="Duration" val={durationLabel} />
                {burnMins !== null && burnMins !== undefined && (
                  <Row label="Burn limit" val={`~${burnMins}m`} />
                )}
                <Row
                  label="Best window"
                  val={windowLabel}
                  accent={bestWindow ? '#16A34A' : '#DC2626'}
                />
              </div>

              <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border-md)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '2px', width: `${pctDaySafe}%`,
                  background: pctDaySafe >= 60 ? '#16A34A' : pctDaySafe >= 30 ? '#D97706' : '#DC2626',
                }} />
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-3)' }}>{pctDaySafe}% of day is safe</p>

              {bestWindow && (
                calendarAllowed ? (
                  <button
                    className="btn"
                    onClick={() => window.open(gcalLink(activity.name, bestWindow, activity.durationMins, daysFromNow), '_blank')}
                    style={{ justifyContent: 'center', fontSize: '12px', marginTop: 'auto' }}
                  >
                    📅 Add to Calendar
                  </button>
                ) : (
                  <button className="btn" style={{ justifyContent: 'center', fontSize: '12px', marginTop: 'auto', opacity: 0.45, cursor: 'not-allowed' }}
                    title="Sign in for free to unlock calendar sync" disabled>
                    🔒 Calendar (sign in)
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
