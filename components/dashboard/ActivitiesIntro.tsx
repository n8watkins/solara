import m from '@/messages/dashboard'
/**
 * The Activities section's heading, with Add on the left and Manage on the right.
 * With no activities yet the empty state below offers the one Add button instead.
 */
export default function ActivitiesIntro({
  onAdd,
  onManage,
  hasActivities,
}: {
  onAdd: () => void
  onManage: () => void
  hasActivities: boolean
}) {
  return (
    <div className="mb-3">
      <p className="text-[16px] font-bold text-ink">{m.activities}</p>
      <p className="mt-[3px] text-[13px] text-ink-3">{m.activitiesIntro}</p>
      {/* space-between keeps the two actions apart, never clustered together. */}
      {hasActivities && (
        <div className="mt-3 flex items-center justify-between gap-2.5">
          <button className="btn btn-primary px-3.5 py-2 text-[13px]" onClick={onAdd}>
            {m.addActivity}
          </button>
          <button className="btn px-3.5 py-2 text-[13px]" onClick={onManage}>
            {m.manage}
          </button>
        </div>
      )}
    </div>
  )
}
