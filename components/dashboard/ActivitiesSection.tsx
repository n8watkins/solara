import { useState } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import type { DashboardAccess } from '@/lib/dashboard-view'
import type { ActivityDayPlan } from '@/lib/next-slot'
import type { BusyInterval, SlotRecommendation } from '@/lib/scheduler'
import { scheduledOn, type ScheduledActivity } from '@/lib/scheduled'
import { isCalendarConfigured } from '@/lib/gcal'
import { canAddActivity, canUseCalendar, TIER_LIMITS } from '@/lib/tiers'
import { isReturningGuest } from '@/lib/guest'
import { useUpsellDismissal } from '@/lib/upsell'
import GoogleSignInButton from '../GoogleSignInButton'
import Upsell from '../Upsell'
import type { useCalendarBusy } from '@/hooks/useCalendarBusy'
import ActivityCards from '../ActivityCards'
import { CalendarFeed } from '../deferred'
import PlanAhead from '../PlanAhead'
import ActivitiesIntro from './ActivitiesIntro'
import ActivityEmptyState from './ActivityEmptyState'
import ActivityModals from './ActivityModals'
import CalendarConnectBanner from './CalendarConnectBanner'

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
}) {
  const [modal, setModal] = useState<'add' | 'manage' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const hasActivities = prefs.activities.length > 0
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
      <ActivitiesIntro onAdd={add} onManage={() => setModal('manage')} />

      {showSavePlan && (
        <div className="mb-3.5">
          <Upsell
            icon="💾"
            title="Save your plan, sign in free"
            action={<GoogleSignInButton label="Sign in free" />}
            onDismiss={dismissSavePlan}
            focusOnShow={wantsMore}
          >
            Your plan is kept only on this device. Sign in with Google to keep it on every device,
            plan up to {TIER_LIMITS.free.activities} activities and see tomorrow too.
          </Upsell>
        </div>
      )}

      {hasActivities && (
        <div className="mb-3.5">
          <PlanAhead
            forecast={weather.forecast}
            activities={prefs.activities}
            skinType={prefs.skinType}
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
        />
      ) : (
        <ActivityEmptyState onAdd={() => setModal('add')} />
      )}

      <ActivityModals
        modal={modal}
        onModalChange={setModal}
        editingId={editingId}
        onEdit={activity => setEditingId(activity?.id ?? null)}
        prefs={prefs}
        tier={access.activityTier}
        onPrefsUpdate={onPrefsUpdate}
      />
    </section>
  )
}
