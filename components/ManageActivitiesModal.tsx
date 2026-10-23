'use client'
import type { Activity, TierLevel } from '@/lib/types'
import { canAddActivity, effectiveMaxUV } from '@/lib/tiers'
import ActivityModalShell from './ActivityModalShell'

interface Props {
  activities: Activity[]
  tier: TierLevel
  onActivitiesChange: (activities: Activity[]) => void
  onAddActivity: () => void
  onEditActivity: (activity: Activity) => void
  onClose: () => void
}

export default function ManageActivitiesModal({
  activities,
  tier,
  onActivitiesChange,
  onAddActivity,
  onEditActivity,
  onClose,
}: Props) {
  function remove(id: string) {
    onActivitiesChange(activities.filter(a => a.id !== id))
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

  const atLimit = !canAddActivity(tier, activities.length)

  return (
    <ActivityModalShell
      title="Manage activities"
      description="Review saved activities. Use Edit for deeper customization, or Add Activity to browse presets."
      onClose={onClose}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button type="button" className="btn" onClick={onAddActivity}>
            + Add another
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{ minWidth: '120px', justifyContent: 'center' }}
          >
            Done
          </button>
        </div>
      }
    >
      {activities.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <p aria-hidden="true" style={{ fontSize: '32px', margin: '0 0 10px' }}>
            🏃
          </p>
          <h3
            style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}
          >
            No activities yet
          </h3>
          <p
            style={{
              margin: '0 0 18px',
              fontSize: '13px',
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            Add an activity first, then come back here to manage it.
          </p>
          <button type="button" className="btn btn-primary" onClick={onAddActivity}>
            + Add activity
          </button>
        </div>
      ) : (
        <ul
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {activities.map(activity => {
            const durationLabel =
              activity.durationMins < 60
                ? `${activity.durationMins}m`
                : `${activity.durationMins / 60}h`
            const safeUv = effectiveMaxUV(activity)
            return (
              <li
                key={activity.id}
                style={{
                  border: '0.5px solid var(--border-md)',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  background: 'var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: '24px' }}>
                  {activity.icon}
                </span>
                <div style={{ flex: 1, minWidth: '170px' }}>
                  <h3
                    style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}
                  >
                    {activity.name}
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
                    {durationLabel} · {activity.sunscreen ? 'SPF 30+' : 'No SPF'} · UV limit{' '}
                    {safeUv}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    aria-label={`Edit ${activity.name}`}
                    className="btn btn-primary"
                    onClick={() => onEditActivity(activity)}
                    style={{ fontSize: '12px' }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate ${activity.name}`}
                    className="btn"
                    onClick={() => duplicate(activity)}
                    disabled={atLimit}
                    style={{ fontSize: '12px' }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${activity.name}`}
                    className="btn"
                    onClick={() => remove(activity.id)}
                    style={{ fontSize: '12px', color: 'var(--danger)', borderColor: '#FECACA' }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </ActivityModalShell>
  )
}
