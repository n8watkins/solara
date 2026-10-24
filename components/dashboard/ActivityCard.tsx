import type { SafeActivityWindow } from '@/lib/types'
import type { ActivityDayPlan } from '@/lib/next-slot'
import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import { recommendSlot, type SlotRecommendation } from '@/lib/scheduler'
import { effectiveMaxUV } from '@/lib/tiers'
import { fmtDays } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import {
  activityBadge,
  bestWindowLabel,
  durationLabel,
  isRecommendationScheduled,
  matchTone,
} from '@/lib/activity-card-view'
import RecommendedSlot from './RecommendedSlot'
import ScheduledCardRow from './ScheduledCardRow'
import WindowRow from './WindowRow'

const MATCH_BAR = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const

function Stat({ label, val, tone }: { label: string; val: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex justify-between text-[12px]">
      <span className="text-ink-3">{label}</span>
      <span className={`font-medium ${color}`}>{val}</span>
    </div>
  )
}

/** One activity's plan for the selected day. */
export default function ActivityCard({
  plan,
  isToday,
  scheduled,
  calendarHref,
  onBook,
  onShare,
  onEdit,
  onOpenScheduled,
}: {
  plan: ActivityDayPlan
  isToday: boolean
  scheduled: { item: ScheduledActivity; span: ScheduledSpan }[]
  /** A prefilled Google Calendar link for a span; absent when the tier has no calendar. */
  calendarHref?: (span: { from: number; to: number }) => string
  /** Books a slot as a real event (calendar connected and allowed). */
  onBook?: (rec: SlotRecommendation) => void
  onShare: (win: SafeActivityWindow) => void
  onEdit?: () => void
  onOpenScheduled?: (item: ScheduledActivity) => void
}) {
  const fmt = useUnits()
  const { activity, bestWindow, windows, slot: rec, pctDaySafe, burnMins } = plan
  const badge = activityBadge(plan, isToday)
  const safeUv = effectiveMaxUV(activity)
  const days = fmtDays(activity.daysOfWeek)
  // Once the recommended slot is on the calendar, the Scheduled row replaces it.
  const recScheduled = isRecommendationScheduled(rec, scheduled)

  return (
    <div
      className="card flex flex-col gap-2.5"
      data-testid="activity-card"
      data-activity={activity.id}
    >
      <div className="flex items-center gap-2">
        <span className="text-[18px]">{activity.icon}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{activity.name}</span>
        <span className={`badge badge-${badge.status} shrink-0`}>{badge.label}</span>
        {onEdit && (
          <button
            className="btn btn-ghost ml-auto shrink-0 px-2 py-1 text-[13px]"
            onClick={onEdit}
            aria-label={`Edit ${activity.name}`}
            title="Edit activity"
          >
            ✎
          </button>
        )}
      </div>

      {scheduled.map(({ item, span }) => (
        <ScheduledCardRow
          key={item.eventId}
          item={item}
          span={span}
          activityName={activity.name}
          onManage={onOpenScheduled}
        />
      ))}

      {rec && !recScheduled && (
        <RecommendedSlot
          rec={rec}
          onBook={onBook && (() => onBook(rec))}
          calendarHref={calendarHref?.({ from: rec.start, to: rec.end })}
        />
      )}

      <div className="flex flex-col gap-[5px]">
        <Stat
          label={activity.sunscreen ? 'UV limit w/ SPF' : 'Planning UV limit'}
          val={String(safeUv)}
        />
        <Stat label="Duration" val={durationLabel(activity.durationMins)} />
        {activity.preferredHours && (
          <Stat
            label="Preferred"
            val={`${fmt.hour(activity.preferredHours.from)}–${fmt.hour(activity.preferredHours.to)}`}
          />
        )}
        {days && <Stat label="Days" val={days} />}
        {burnMins !== null && burnMins !== undefined && (
          <Stat label="Threshold burn est." val={`~${burnMins}m`} />
        )}
        <Stat
          label="Best window"
          val={bestWindowLabel(plan, isToday, fmt.time)}
          tone={bestWindow ? 'success' : 'danger'}
        />
      </div>

      <div>
        <div className="h-1 overflow-hidden rounded-[2px] bg-line-strong">
          <div
            className={`h-full rounded-[2px] ${MATCH_BAR[matchTone(pctDaySafe)]}`}
            style={{ width: `${pctDaySafe}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink-3">{pctDaySafe}% of visible day matches</p>
      </div>

      <div className="flex flex-col gap-[7px]">
        <p className="text-[11px] font-bold tracking-[0.055em] text-ink-3 uppercase">
          {isToday ? 'Lower-UV windows left today' : 'Estimated lower-UV windows'}
        </p>
        {windows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {windows.map(win => (
              <WindowRow
                key={`${win.from}-${win.to}`}
                win={win}
                isBest={!!bestWindow && win.from === bestWindow.from && win.to === bestWindow.to}
                cloudNote={!!activity.cloudSensitive && win.peakUV > safeUv}
                onShare={() => onShare(win)}
                calendarHref={calendarHref?.(win)}
                onSchedule={
                  onBook &&
                  (() => {
                    const slot = recommendSlot(
                      [win],
                      [],
                      activity.durationMins,
                      activity.timePreference ?? 'earliest',
                    )
                    if (slot) onBook(slot)
                  })
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-[1.45] text-ink-3">
            {plan.elapsed
              ? "Today's matching windows have passed. See Best day this week for the next one."
              : `No forecast window matches this activity ${isToday ? 'today' : 'this day'}. Try shortening the duration, widening preferred hours, or adjusting the planning UV limit.`}
          </p>
        )}
      </div>
    </div>
  )
}
