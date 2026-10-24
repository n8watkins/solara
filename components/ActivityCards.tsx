'use client'
import type { Activity, SafeActivityWindow, TierLevel, Location } from '@/lib/types'
import { gcalLink } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import { useStatusFlash } from '@/hooks/useStatusFlash'
import { canUseCalendar } from '@/lib/tiers'
import { buildActivityShareText, buildActivityShareUrl, shareOrCopy } from '@/lib/share'
import type { SlotRecommendation } from '@/lib/scheduler'
import type { ActivityDayPlan } from '@/lib/next-slot'
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
}: Props) {
  const fmt = useUnits()
  const confirm = useStatusFlash(4500)
  const calendarAllowed = canUseCalendar(tier)

  async function shareWindow(activity: Activity, selectedWindow: SafeActivityWindow) {
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
            />
          )
        })}
      </div>
      <p className="mx-0.5 mt-2.5 text-[11px] leading-normal text-ink-3">
        Forecast-based planning estimate only. Conditions can change; use appropriate sun
        protection.
      </p>
    </div>
  )
}
