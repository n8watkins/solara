'use client'
import type { Activity, TierLevel } from '@/lib/types'
import { canAddActivity, effectiveMaxUV } from '@/lib/tiers'
import { duplicateActivity, formatActivityDuration, removeActivity } from '@/lib/activity-presets'
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
  const atLimit = !canAddActivity(tier, activities.length)

  return (
    <ActivityModalShell
      title="Manage activities"
      description="Edit, duplicate or remove your saved activities. To browse presets, use Add another."
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-between gap-2.5">
          <button type="button" className="btn" onClick={onAddActivity}>
            + Add another
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-[120px] justify-center"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      }
    >
      {activities.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p aria-hidden="true" className="mb-2.5 text-[32px]">
            🏃
          </p>
          <h3 className="mb-1.5 text-[16px] font-bold text-ink">No activities yet</h3>
          <p className="mb-[18px] text-[13px] leading-normal text-ink-3">
            Add an activity first, then come back here to manage it.
          </p>
          <button type="button" className="btn btn-primary" onClick={onAddActivity}>
            + Add activity
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {activities.map(activity => (
            <li
              key={activity.id}
              className="flex flex-wrap items-center gap-3 rounded-[14px] border-[0.5px] border-line-strong bg-surface-card px-3.5 py-3"
            >
              <span aria-hidden="true" className="text-[24px]">
                {activity.icon}
              </span>
              <div className="min-w-[170px] flex-1">
                <h3 className="text-[14px] font-bold text-ink">{activity.name}</h3>
                <p className="mt-[3px] text-[12px] text-ink-3">
                  {formatActivityDuration(activity.durationMins)} ·{' '}
                  {activity.sunscreen ? 'SPF 30+' : 'No SPF'} · UV limit {effectiveMaxUV(activity)}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={`Edit ${activity.name}`}
                  className="btn btn-primary text-[12px]"
                  onClick={() => onEditActivity(activity)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${activity.name}`}
                  className="btn text-[12px]"
                  onClick={() =>
                    onActivitiesChange([...activities, duplicateActivity(activity, Date.now())])
                  }
                  disabled={atLimit}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${activity.name}`}
                  className="btn border-danger/30 text-[12px] text-danger"
                  onClick={() => onActivitiesChange(removeActivity(activities, activity.id))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ActivityModalShell>
  )
}
