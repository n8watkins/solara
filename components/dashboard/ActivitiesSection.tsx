import { planningFor } from '@solara/core'
import type { BodyArea } from '@solara/core/sunscreen'
import { useState } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import type { DashboardAccess } from '@/lib/dashboard-view'
import type { ActivityDayPlan } from '@solara/core/next-slot'
import type { BusyInterval, SlotRecommendation } from '@solara/core/scheduler'
import { scheduledOn, type ScheduledActivity } from '@/lib/scheduled-view'
import { isCalendarConfigured } from '@/lib/gcal-view'
import { canAddActivity, canUseCalendar, TIER_LIMITS } from '@solara/core/tiers'
import { isReturningGuest } from '@/lib/guest'
import { useUpsellDismissal } from '@/lib/upsell'
import GoogleSignInButton from '../GoogleSignInButton'
import Upsell from '../Upsell'
import type { useCalendarBusy } from '@/hooks/useCalendarBusy'
import {
  ActivityCards,
  ActivityModals,
  CalendarConnectBanner,
  CalendarFeed,
  PlanAhead,
  useActivityPlanning,
} from '../deferred'
import ActivitiesIntro from './ActivitiesIntro'
import ActivityEmptyState from './ActivityEmptyState'
import m from '@/messages/dashboard'

/**
 * The dashboard's Activities section: the week's best days, calendar options,
 * one card per activity for the selected day, and the add, manage and edit
 * dialogs. A guest who reaches the guest plan's limit, or comes back on a later
 * day, is offered free sign-in to save the plan.
 */
export default function ActivitiesSection({
  prefs,
  weather,
  access,
  plans,
  isToday,
  dateStr,
  dateLabel,
  nowHour,
  busyByDate,
  calendar,
  onBook,
  scheduledItems,
  onOpenScheduled,
  onUpgrade,
  onPrefsUpdate,
  onLogActivity,
}: {
  prefs: UserPreferences
  weather: WeatherResponse
  access: DashboardAccess
  /** One plan per activity for the selected day. */
  plans: ActivityDayPlan[]
  isToday: boolean
  /** The selected day, YYYY-MM-DD in the forecast's zone. */
  dateStr: string
  dateLabel: string
  /** Fractional "now" on the forecast's today. */
  nowHour: number
  busyByDate: Record<string, BusyInterval[]>
  calendar: ReturnType<typeof useCalendarBusy>
  /** Books a slot on Google Calendar; absent when scheduling is unavailable. */
  onBook?: (activity: Activity, rec: SlotRecommendation, dateStr: string) => void
  scheduledItems: ScheduledActivity[]
  onOpenScheduled: (item: ScheduledActivity) => void
  onUpgrade: () => void
  onPrefsUpdate: (prefs: UserPreferences) => void
  /** Logs a finished activity in the vitamin D log; absent when the log is off or not today. */
  onLogActivity?: (activity: Activity, areas: readonly BodyArea[]) => void
}) {
  const planner = useActivityPlanning()
  const [modal, setModal] = useState<'add' | 'manage' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const hasActivities = prefs.activities.length > 0
  const skinType = planningFor(prefs).skinType
  const guest = access.activityTier === 'anonymous'
  const [savePlanDismissed, dismissSavePlan] = useUpsellDismissal('save-plan')
  const [returningGuest] = useState(() => guest && isReturningGuest())
  // Set when a guest tries to add more than the guest plan holds.
  const [wantsMore, setWantsMore] = useState(false)
  const showSavePlan = guest && !savePlanDismissed && (wantsMore || returningGuest)

  function add() {
    // The natural moment to offer sign-in: a guest asking for a second activity.
    if (guest && !savePlanDismissed && !canAddActivity('anonymous', prefs.activities.length)) {
      setWantsMore(true)
      return
    }
    setModal('add')
  }
  // Calendar sync (Google Calendar, the live feed and the .ics export), per plan.
  const calendarIncluded = canUseCalendar(access.accessTier)

  return (
    <section>
      <ActivitiesIntro
        onAdd={add}
        onManage={() => setModal('manage')}
        hasActivities={hasActivities}
      />

      {showSavePlan && (
        <div className="mb-3.5">
          <Upsell
            icon="💾"
            title={m.savePlanTitle}
            action={<GoogleSignInButton label={m.signInFree} />}
            onDismiss={dismissSavePlan}
            focusOnShow={wantsMore}
          >
            {m.savePlanBody(TIER_LIMITS.free.activities)}
          </Upsell>
        </div>
      )}

      {hasActivities && (
        <div className="mb-3.5">
          <PlanAhead
            forecast={weather.forecast}
            activities={prefs.activities}
            skinType={skinType}
            dayLimit={access.accessibleDays}
            busyByDate={busyByDate}
            nowHourToday={nowHour}
            lockedDays={access.lockedForecastCount}
            upgradeCopy={access.upgradeCopy}
            onUpgrade={onUpgrade}
            onBook={calendarIncluded ? onBook : undefined}
            canExport={calendarIncluded}
          />
        </div>
      )}

      {hasActivities && calendarIncluded && isCalendarConfigured() && (
        <CalendarConnectBanner status={calendar.status} onConnect={() => void calendar.connect()} />
      )}

      {hasActivities && calendarIncluded && <CalendarFeed prefs={prefs} />}

      {hasActivities ? (
        <ActivityCards
          plans={plans}
          isToday={isToday}
          dateStr={dateStr}
          timeZone={weather.timezone}
          tier={access.accessTier}
          location={prefs.location}
          dateLabel={dateLabel}
          onBookRecommended={onBook && ((a, r) => onBook(a, r, dateStr))}
          onEditActivity={activity => setEditingId(activity.id)}
          scheduledFor={activityId =>
            scheduledOn(scheduledItems, activityId, dateStr, weather.timezone)
          }
          onOpenScheduled={onOpenScheduled}
          onLogActivity={onLogActivity}
          laterDaysVisible={access.accessibleDays > 1}
          nextSlotFor={activity =>
            planner?.nextSlotAfterToday(
              weather.forecast,
              [activity],
              skinType,
              access.accessibleDays,
              busyByDate,
            ) ?? null
          }
        />
      ) : (
        <ActivityEmptyState onAdd={() => setModal('add')} />
      )}

      {/* Loaded on demand, and mounted only while one of the dialogs is open. */}
      {(modal || editingId) && (
        <ActivityModals
          modal={modal}
          onModalChange={setModal}
          editingId={editingId}
          onEdit={activity => setEditingId(activity?.id ?? null)}
          prefs={prefs}
          tier={access.activityTier}
          onPrefsUpdate={onPrefsUpdate}
        />
      )}
    </section>
  )
}
