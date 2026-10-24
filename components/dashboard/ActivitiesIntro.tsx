/** The Activities section's heading, with Add on the left and Manage on the right. */
export default function ActivitiesIntro({
  onAdd,
  onManage,
}: {
  /** Absent for guests, who get a sign-in prompt instead of the actions. */
  onAdd?: () => void
  onManage?: () => void
}) {
  return (
    <div className="mb-3">
      <p className="text-[16px] font-bold text-ink">Activities</p>
      <p className="mt-[3px] text-[13px] text-ink-3">
        Add what you do outside, then Solara estimates lower-UV windows.
      </p>
      {/* space-between keeps the two actions apart, never clustered together. */}
      {onAdd && onManage && (
        <div className="mt-3 flex items-center justify-between gap-2.5">
          <button className="btn btn-primary px-3.5 py-2 text-[13px]" onClick={onAdd}>
            + Add Activity
          </button>
          <button className="btn px-3.5 py-2 text-[13px]" onClick={onManage}>
            Manage
          </button>
        </div>
      )}
    </div>
  )
}
