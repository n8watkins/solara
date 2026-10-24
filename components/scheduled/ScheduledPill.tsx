/**
 * "✓ Scheduled": the same green pair as .badge-safe, so "scheduled" and "safe now"
 * share one meaning of green across the app.
 */
export default function ScheduledPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#d1fae5] px-2 py-0.5 text-[11px] leading-4 font-[650] whitespace-nowrap text-[#065f46] dark:bg-[#064e3b] dark:text-[#6ee7b7]">
      ✓ Scheduled
    </span>
  )
}
