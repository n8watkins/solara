/** The Activities section with nothing to show: a prompt to add the first activity. */
export default function ActivityEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="card px-6 py-11 text-center">
      <p className="mb-2.5 text-[30px]">🏃</p>
      <p className="mb-[7px] text-[16px] font-[650] text-ink">No activities set up yet</p>
      <p className="mb-5 text-[14px] leading-[1.55] text-ink-3">
        Add your outdoor activities to see forecast-based, lower-UV planning windows.
      </p>
      <button className="btn btn-primary rounded-xl px-6 py-2.5 text-[14px]" onClick={onAdd}>
        + Add Activity
      </button>
    </div>
  )
}
