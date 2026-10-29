'use client'
import type { Activity, SafeActivityWindow, TierLevel, Location } from '@/lib/types'
import { gcalLink } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import { useStatusFlash } from '@/hooks/useStatusFlash'
import { canUseCalendar } from '@solara/core/tiers'
import type * as ShareCode from '@/lib/share'
import type { SlotRecommendation } from '@solara/core/scheduler'
import type { ActivityDayPlan } from '@solara/core/next-slot'
import type { UpcomingSlot } from '@solara/core/planner'
import { windowsPassedNote } from '@/lib/dashboard-view'
import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import ActivityCard from './dashboard/ActivityCard'

interface Props {
  /** One plan per activity for the selected day (see planActivityDay). */
  plans: ActivityDayPlan[]
  isToday: boolean
  /** The plans' date (YYYY-MM-DD) in the forecast location's zone. */
  dateStr: string
  /** The forecast location's IANA zone; calendar links are built in it. */
  timeZone: string
  tier: TierLevel
  location: Location
  dateLabel: string
  /** When provided (calendar connected), books the recommended slot as a real event. */
  onBookRecommended?: (activity: Activity, rec: SlotRecommendation) => void
  onEditActivity?: (activity: Activity) => void
  /** The activity's scheduled Google Calendar events on this day. */
  scheduledFor?: (activityId: string) => { item: ScheduledActivity; span: ScheduledSpan }[]
  /** Opens a scheduled event's details (change time, remove). */
  onOpenScheduled?: (item: ScheduledActivity) => void
  /** The plan shows days after today (false on the guest plan). */
  laterDaysVisible: boolean
  /** An activity's soonest slot after today, for a card whose windows have passed. */
  nextSlotFor: (activity: Activity) => UpcomingSlot | null
}

export default function ActivityCards({
  plans,
  isToday,
  dateStr,
  timeZone,
  tier,
  location,
  dateLabel,
  onBookRecommended,
  onEditActivity,
  scheduledFor,
  onOpenScheduled,
  laterDaysVisible,
  nextSlotFor,
}: Props) {
  const fmt = useUnits()
  const confirm = useStatusFlash(4500)
  const calendarAllowed = canUseCalendar(tier)

  async function shareWindow(activity: Activity, selectedWindow: SafeActivityWindow) {
    // The share code loads in the background soon after the page loads
    // (components/deferred.tsx), so this is normally instant and the share sheet
    // still opens within the tap's user activation.
    let share: typeof ShareCode
    try {
      share = await import('@/lib/share')
    } catch {
      confirm.flash('Could not share. Check your connection and try again.')
      return
    }
    const { buildActivityShareText, buildActivityShareUrl, shareOrCopy } = share
    const payload = {
      activity,
      window: selectedWindow,
      location,
      dateLabel,
      isoDate: dateStr,
    }
    const text = buildActivityShareText(payload, fmt.units.clock)
    const url = buildActivityShareUrl(
      payload,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    )
    let result: Awaited<ReturnType<typeof shareOrCopy>>
    try {
      result = await shareOrCopy(`${activity.name} sun window`, text, url)
    } catch {
      // AbortError: the share sheet was dismissed, so no feedback is needed.
      return
    }
    confirm.flash(
      result === 'shared'
        ? 'Shared activity window.'
        : result === 'copied'
          ? 'Copied share text and link.'
          : 'Sharing is not supported here. Copy the link manually.',
    )
  }

  return (
    <div>
      {confirm.message && (
        <p role="status" className="mb-3 text-right text-[12px] text-accent">
          {confirm.message}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
        {plans.map(plan => {
          const { activity } = plan
          return (
            <ActivityCard
              key={activity.id}
              plan={plan}
              isToday={isToday}
              scheduled={scheduledFor?.(activity.id) ?? []}
              // Calendar actions are plain links (rel=noopener), so they are never
              // pop-up blocked and the new tab cannot reach back into this one.
              calendarHref={
                calendarAllowed
                  ? span => gcalLink(activity.name, span, activity.durationMins, dateStr, timeZone)
                  : undefined
              }
              onBook={
                calendarAllowed && onBookRecommended
                  ? rec => onBookRecommended(activity, rec)
                  : undefined
              }
              onShare={win => void shareWindow(activity, win)}
              onEdit={onEditActivity && (() => onEditActivity(activity))}
              onOpenScheduled={onOpenScheduled}
              passedNote={
                plan.elapsed
                  ? windowsPassedNote(nextSlotFor(activity), laterDaysVisible, fmt.time)
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
