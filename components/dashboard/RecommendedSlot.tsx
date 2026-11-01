import { CalendarPlus } from 'lucide-react'
import type { SlotRecommendation } from '@solara/core/scheduler'
import { useUnits } from '@/lib/use-units'
import { windowLabelText } from '@solara/core/recommendation'
import m from '@/messages/activities'

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
          {m.recommended}
        </span>
        <span className="text-[10px] text-ink-3">{windowLabelText(rec.windowLabel)}</span>
      </div>
      <p className="mt-[3px] text-[15px] font-[750] text-ink">
        {fmt.time(rec.start)}–{fmt.time(rec.end)}
      </p>
      <p className="mt-0.5 text-[11px] leading-[1.4] text-ink-3">
        {rec.reason}
        {rec.latestStart > rec.earliestStart && (
          <>
            {m.couldStartAnytime}{' '}
            <span className="whitespace-nowrap">
              {fmt.time(rec.earliestStart)}–{fmt.time(rec.latestStart)}
            </span>
          </>
        )}
        {/* The sentence's period, unless a time such as "7:15 p.m." already closes it. */}
        {(rec.latestStart > rec.earliestStart ? fmt.time(rec.latestStart) : rec.reason).endsWith(
          '.',
        )
          ? null
          : '.'}
      </p>
      {onBook ? (
        <button className={ACTION} onClick={onBook}>
          <CalendarPlus size={15} /> {m.addToGoogleCalendar}
        </button>
      ) : (
        calendarHref && (
          <a
            className={`${ACTION} no-underline`}
            href={calendarHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            <CalendarPlus size={15} /> {m.addToCalendar}
          </a>
        )
      )}
    </div>
  )
}
