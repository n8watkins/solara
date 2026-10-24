import type { SlotRecommendation } from '@/lib/scheduler'
import { useUnits } from '@/lib/use-units'

const ACTION = 'btn mt-2 w-full justify-center text-[12px]'

/**
 * The activity card's recommended slot. `onBook` books it as a real Google
 * Calendar event; otherwise `calendarHref` links to a prefilled event. Neither
 * means the plan has no calendar actions.
 */
export default function RecommendedSlot({
  rec,
  onBook,
  calendarHref,
}: {
  rec: SlotRecommendation
  onBook?: () => void
  calendarHref?: string
}) {
  const fmt = useUnits()
  return (
    <div
      data-testid="recommended-slot"
      data-start={rec.start}
      data-end={rec.end}
      className="rounded-[9px] border-[0.5px] border-brand/25 bg-brand/7 px-2.5 py-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-[750] tracking-[0.05em] text-accent uppercase">
          Recommended
        </span>
        <span className="text-[10px] text-ink-3">{rec.windowLabel}</span>
      </div>
      <p className="mt-[3px] text-[15px] font-[750] text-ink">
        {fmt.time(rec.start)}–{fmt.time(rec.end)}
      </p>
      <p className="mt-0.5 text-[11px] leading-[1.4] text-ink-3">
        {rec.reason}
        {rec.latestStart > rec.earliestStart && (
          <>
            . Could start anytime{' '}
            <span className="whitespace-nowrap">
              {fmt.time(rec.earliestStart)}–{fmt.time(rec.latestStart)}
            </span>
          </>
        )}
        .
      </p>
      {onBook ? (
        <button className={ACTION} onClick={onBook}>
          📅 Add to Google Calendar
        </button>
      ) : (
        calendarHref && (
          <a
            className={`${ACTION} no-underline`}
            href={calendarHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            📅 Add to Calendar
          </a>
        )
      )}
    </div>
  )
}
