'use client'
import { Activity, TierLevel } from '@/lib/types'
import { effectiveMaxUV } from '@/lib/tiers'
import ActivityModalShell from './ActivityModalShell'

interface Props {
  activities: Activity[]
  tier: TierLevel
  onActivitiesChange: (activities: Activity[]) => void
  onAddActivity: () => void
  onClose: () => void
}

export default function ManageActivitiesModal({ activities, tier, onActivitiesChange, onAddActivity, onClose }: Props) {
  function remove(id: string) {
    onActivitiesChange(activities.filter(a => a.id !== id))
  }

  function updateDuration(id: string, mins: number) {
    onActivitiesChange(activities.map(a => a.id === id ? { ...a, durationMins: Math.max(5, mins) } : a))
  }

  function updateSunscreen(id: string, sunscreen: boolean) {
    onActivitiesChange(activities.map(a => a.id === id ? { ...a, sunscreen } : a))
  }

  function duplicate(activity: Activity) {
    onActivitiesChange([
      ...activities,
      {
        ...activity,
        id: `custom_${Date.now()}`,
        name: `${activity.name} copy`,
        custom: true,
      },
    ])
  }

  return (
    <ActivityModalShell
      title="Manage activities"
      description="Edit the activities you already use. Preset browsing lives in Add Activity."
      onClose={onClose}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn" onClick={onAddActivity}>+ Add another</button>
          <button className="btn btn-primary" onClick={onClose} style={{ minWidth: '120px', justifyContent: 'center' }}>Done</button>
        </div>
      )}
    >
      {activities.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <p style={{ fontSize: '32px', margin: '0 0 10px' }}>🏃</p>
          <p style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>No activities yet</p>
          <p style={{ margin: '0 0 18px', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.5 }}>
            Add an activity first, then come back here to manage it.
          </p>
          <button className="btn btn-primary" onClick={onAddActivity}>+ Add activity</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activities.map(activity => {
            const durationLabel = activity.durationMins < 60 ? `${activity.durationMins}m` : `${activity.durationMins / 60}h`
            const safeUv = effectiveMaxUV(activity)
            return (
              <div key={activity.id} style={{ border: '0.5px solid var(--border-md)', borderRadius: '14px', padding: '12px 14px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '22px' }}>{activity.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{activity.name}</p>
                    <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
                      {durationLabel} · {activity.sunscreen ? 'SPF 30+' : 'No SPF'} · Safe UV {safeUv}
                    </p>
                  </div>
                  <button className="btn" onClick={() => duplicate(activity)} disabled={tier !== 'paid' && activities.length >= (tier === 'anonymous' ? 1 : 3)} style={{ fontSize: '12px' }}>
                    Duplicate
                  </button>
                  <button className="btn" onClick={() => remove(activity.id)} style={{ fontSize: '12px', color: '#DC2626', borderColor: '#FECACA' }}>
                    Remove
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(180px, 1fr)', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-metric)', padding: '9px 10px', borderRadius: '10px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Duration</span>
                    <button onClick={() => updateDuration(activity.id, activity.durationMins - 15)} style={{ width: '26px', height: '26px', borderRadius: '7px', border: '0.5px solid var(--border-md)', background: 'var(--bg-card)', cursor: 'pointer' }}>−</button>
                    <span style={{ fontSize: '13px', color: 'var(--text)', minWidth: '38px', textAlign: 'center', fontWeight: 650 }}>{durationLabel}</span>
                    <button onClick={() => updateDuration(activity.id, activity.durationMins + 15)} style={{ width: '26px', height: '26px', borderRadius: '7px', border: '0.5px solid var(--border-md)', background: 'var(--bg-card)', cursor: 'pointer' }}>+</button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { val: false, label: 'No SPF' },
                      { val: true, label: 'SPF 30+' },
                    ].map(option => (
                      <button
                        key={String(option.val)}
                        onClick={() => updateSunscreen(activity.id, option.val)}
                        style={{
                          flex: 1,
                          padding: '9px 10px',
                          borderRadius: '10px',
                          border: activity.sunscreen === option.val ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                          background: activity.sunscreen === option.val ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 650,
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ActivityModalShell>
  )
}
