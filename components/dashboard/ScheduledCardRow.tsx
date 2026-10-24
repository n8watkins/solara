import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import { useUnits } from '@/lib/use-units'
import styles from '../Scheduled.module.css'

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
    <div className={styles.cardRow} data-testid="scheduled-card-row" data-event-id={item.eventId}>
      <div className={styles.cardText}>
        <span className={styles.pill}>✓ Scheduled</span>
        <span className={styles.cardTime}>{range}</span>
      </div>
      <div className={styles.cardActions}>
        <a
          className={`btn ${styles.small}`}
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
            className={`btn ${styles.small}`}
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
