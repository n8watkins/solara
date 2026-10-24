import clsx from 'clsx'
import { VIEWS, type ViewKey } from '@/lib/calendar-layout'
import type { Activity } from '@/lib/types'

export interface Pager {
  /** "Jun 15 – 21": the days in view. */
  label: string
  canBack: boolean
  canForward: boolean
  onPage: (direction: 1 | -1) => void
}

const pagerButton = 'btn h-8 w-8 justify-center p-0 text-[18px] leading-none'

/** Activity filter, hour range switch and, when days scroll, the day pager. */
export default function CalendarToolbar({
  activities,
  activityId,
  onActivity,
  view,
  onView,
  pager,
}: {
  activities: readonly Activity[]
  /** The activity shown alone, or "all". */
  activityId: string
  onActivity: (id: string) => void
  view: ViewKey
  onView: (view: ViewKey) => void
  /** Null when every day fits. */
  pager: Pager | null
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <label className="flex items-center gap-2" htmlFor="calendar-activity-filter">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          Show
        </span>
        <select
          id="calendar-activity-filter"
          value={activityId}
          onChange={e => onActivity(e.target.value)}
          className="px-2 py-1.5 text-[13px]"
        >
          <option value="all">All activities</option>
          {activities.map(a => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
      </label>
      <div
        role="group"
        aria-label="Hours shown"
        className="inline-flex gap-0.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-subtle p-[3px]"
      >
        {VIEWS.map(v => {
          const active = v.key === view
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={active}
              onClick={() => onView(v.key)}
              className={clsx(
                'min-h-7 rounded-[7px] border-none px-2.5 py-[5px] text-[12px] whitespace-nowrap',
                active
                  ? 'bg-surface-card font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'bg-transparent font-medium text-ink-2',
              )}
            >
              {v.label}
            </button>
          )
        })}
      </div>
      {pager && (
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className={pagerButton}
            aria-label="Earlier days"
            disabled={!pager.canBack}
            onClick={() => pager.onPage(-1)}
          >
            ‹
          </button>
          <span
            aria-live="polite"
            className="min-w-[92px] text-center text-[13px] font-semibold text-ink tabular-nums"
          >
            {pager.label}
          </span>
          <button
            type="button"
            className={pagerButton}
            aria-label="Later days"
            disabled={!pager.canForward}
            onClick={() => pager.onPage(1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
