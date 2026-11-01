import m from '@/messages/calendar'
/** The Calendar tab before any activity exists. */
export default function CalendarEmpty() {
  return (
    <div className="py-12 text-center">
      <p className="mb-2.5 text-[34px]">🗓️</p>
      <p className="mb-1.5 text-[16px] font-semibold text-ink">{m.noActivitiesYet}</p>
      <p className="text-[14px] text-ink-3">{m.addFromDashboard}</p>
    </div>
  )
}
