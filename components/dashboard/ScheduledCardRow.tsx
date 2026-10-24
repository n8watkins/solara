import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import { useUnits } from '@/lib/use-units'
import ScheduledPill from '../scheduled/ScheduledPill'

const ACTION = 'btn px-[9px] py-[5px] text-[11px] no-underline'

/** A scheduled Google Calendar event on an activity card: open it or manage it. */
export default function ScheduledCardRow({
  item,
  span,
  activityName,
  onManage,
}: {
  item: ScheduledActivity
  span: ScheduledSpan
  activityName: string
  onManage?: (item: ScheduledActivity) => void
}) {
  const fmt = useUnits()
  const range = `${fmt.time(span.from)}–${fmt.time(span.to)}`
  return (
    // A solid green edge reads as a commitment, next to the suggested windows.
    <div
      className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-[#047857] bg-surface-card px-2.5 py-2 shadow-[inset_3px_0_0_#047857] dark:border-[#34d399] dark:shadow-[inset_3px_0_0_#34d399]"
      data-testid="scheduled-card-row"
      data-event-id={item.eventId}
    >
      <div className="flex-[1_0_auto]">
        <ScheduledPill />
        <span className="mt-0.5 block text-[14px] font-[750] whitespace-nowrap text-ink tabular-nums">
          {range}
        </span>
      </div>
      <div className="flex shrink-0 gap-[5px]">
        <a
          className={ACTION}
          href={item.htmlLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open scheduled ${activityName}, ${range}, in Google Calendar`}
        >
          Open <span aria-hidden="true">↗</span>
        </a>
        {onManage && (
          <button
            type="button"
            className={ACTION}
            aria-haspopup="dialog"
            onClick={() => onManage(item)}
            aria-label={`Manage scheduled ${activityName}, ${range}`}
          >
            Manage
          </button>
        )}
      </div>
    </div>
  )
}
