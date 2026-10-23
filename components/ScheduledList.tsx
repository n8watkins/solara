'use client'
import type { ScheduledActivity } from '@solara/core'
import { activityColor } from '@/lib/activity-colors'
import { scheduledSpan, upcomingScheduled } from '@/lib/scheduled'
import { useScheduled, type SyncChanges } from '@/lib/scheduled-context'
import { useUnits } from '@/lib/use-units'
import type { Activity } from '@/lib/types'
import styles from './Scheduled.module.css'

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
    <section aria-labelledby="scheduled-list-title" className={styles.list}>
      <div className={styles.listHead}>
        <h2 id="scheduled-list-title" className={styles.listTitle}>
          Scheduled
        </h2>
        {upcoming.length > 0 && <span className={styles.count}>{upcoming.length}</span>}
        <div className={styles.syncLine} role="status">
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
                className={`btn ${styles.reconnect}`}
                onClick={() => void scheduled.refresh({ interactive: true })}
              >
                {scheduled.sync === 'reconnect' ? 'Reconnect to sync' : 'Try again'}
              </button>
            </>
          )}
        </div>
      </div>
      {upcoming.length > 0 && (
        <ul className={styles.rows}>
          {upcoming.map(item => {
            const span = scheduledSpan(item, timeZone)
            const activity = activities.find(a => a.id === item.activityId)
            const name = activity?.name ?? item.title
            const when = `${dayLabel(span.date)} · ${fmt.time(span.from)} – ${fmt.time(span.to)}`
            return (
              <li key={item.eventId}>
                <button
                  type="button"
                  className={styles.row}
                  data-testid="scheduled-row"
                  aria-haspopup="dialog"
                  aria-label={`Scheduled: ${name}, ${when}`}
                  onClick={() => onOpen(item)}
                >
                  <span
                    aria-hidden="true"
                    className={`${styles.tile} ${styles.rowTile}`}
                    style={{ background: activityColor(activities, item.activityId) }}
                  >
                    {activity?.icon ?? item.icon}
                    <span className={styles.tileCheck}>✓</span>
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{name}</span>
                    <span className={styles.rowWhen}>{when}</span>
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
