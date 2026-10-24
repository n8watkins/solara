'use client'
import type { ScheduledActivity } from '@solara/core'
import { activityColor } from '@/lib/activity-colors'
import { scheduledSpan, upcomingScheduled } from '@/lib/scheduled'
import { useScheduled, type SyncChanges } from '@/lib/scheduled-context'
import { useUnits } from '@/lib/use-units'
import type { Activity } from '@/lib/types'
import VisuallyHidden from './VisuallyHidden'
import ScheduledTile from './scheduled/ScheduledTile'

interface Props {
  activities: readonly Activity[]
  /** The forecast location's zone: times show in it. */
  timeZone: string
  /** The instant "now" (epoch ms): finished items are left out. */
  nowMs: number
  /** "Today", "Tomorrow" or a short date for a local date. */
  dayLabel: (dateStr: string) => string
  onOpen: (item: ScheduledActivity) => void
}

function changesText({ moved, removed }: SyncChanges): string {
  const parts: string[] = []
  if (moved) parts.push(`${moved} moved`)
  if (removed) parts.push(`${removed} removed`)
  return `Updated from Google Calendar: ${parts.join(', ')}.`
}

/** Upcoming scheduled activities, with their sync state. Hidden when there are none. */
export default function ScheduledList({ activities, timeZone, nowMs, dayLabel, onOpen }: Props) {
  const fmt = useUnits()
  const scheduled = useScheduled()
  const upcoming = upcomingScheduled(scheduled.items, nowMs)
  if (!scheduled.enabled || (upcoming.length === 0 && !scheduled.lastChanges)) return null

  return (
    <section
      aria-labelledby="scheduled-list-title"
      className="mb-4 rounded-xl border-[0.5px] border-line-strong bg-surface-subtle p-3"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 id="scheduled-list-title" className="m-0 text-[14px] font-bold text-ink">
          Scheduled
        </h2>
        {upcoming.length > 0 && (
          <span className="text-[12px] font-semibold text-ink-3 tabular-nums">
            {upcoming.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-3" role="status">
          {scheduled.sync === 'syncing' && 'Checking Google Calendar…'}
          {scheduled.sync === 'synced' &&
            (scheduled.lastChanges
              ? changesText(scheduled.lastChanges)
              : 'In sync with Google Calendar')}
          {(scheduled.sync === 'reconnect' || scheduled.sync === 'error') && (
            <>
              <span>
                {scheduled.sync === 'reconnect'
                  ? 'Showing saved times.'
                  : 'Could not reach Google Calendar.'}
              </span>
              <button
                type="button"
                className="btn min-h-7 px-2.5 py-[5px] text-[12px]"
                onClick={() => void scheduled.refresh({ interactive: true })}
              >
                {scheduled.sync === 'reconnect' ? 'Reconnect to sync' : 'Try again'}
              </button>
            </>
          )}
        </div>
      </div>
      {upcoming.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 p-0">
          {upcoming.map(item => {
            const span = scheduledSpan(item, timeZone)
            const activity = activities.find(a => a.id === item.activityId)
            const name = activity?.name ?? item.title
            const when = `${dayLabel(span.date)} · ${fmt.time(span.from)} – ${fmt.time(span.to)}`
            return (
              <li key={item.eventId}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-card px-2.5 py-2 text-left text-ink hover:bg-surface-metric"
                  data-testid="scheduled-row"
                  aria-haspopup="dialog"
                  onClick={() => onOpen(item)}
                >
                  <ScheduledTile color={activityColor(activities, item.activityId)} small>
                    {activity?.icon ?? item.icon}
                  </ScheduledTile>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-[650]">
                      <VisuallyHidden>Scheduled: </VisuallyHidden>
                      {name}
                    </span>
                    <span className="mt-px block truncate text-[12px] text-ink-2 tabular-nums">
                      {when}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
