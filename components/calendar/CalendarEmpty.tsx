/** The Calendar tab before any activity exists. */
export default function CalendarEmpty() {
  return (
    <div className="py-12 text-center">
      <p className="mb-2.5 text-[34px]">🗓️</p>
      <p className="mb-1.5 text-[16px] font-semibold text-ink">No activities yet</p>
      <p className="text-[14px] text-ink-3">
        Add activities from the Dashboard to see estimated lower-UV windows.
      </p>
    </div>
  )
}
