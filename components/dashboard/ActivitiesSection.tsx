import { useState } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import type { DashboardAccess } from '@/lib/dashboard-view'
import type { ActivityDayPlan } from '@/lib/next-slot'
import type { BusyInterval, SlotRecommendation } from '@/lib/scheduler'
import { scheduledOn, type ScheduledActivity } from '@/lib/scheduled'
import { isCalendarConfigured } from '@/lib/gcal'
import type { useCalendarBusy } from '@/lib/use-calendar-busy'
import ActivityCards from '../ActivityCards'
import CalendarFeed from '../CalendarFeed'
import PlanAhead from '../PlanAhead'
import ActivitiesIntro from './ActivitiesIntro'
import ActivityEmptyState from './ActivityEmptyState'
import ActivityModals from './ActivityModals'
import CalendarConnectBanner from './CalendarConnectBanner'

/**
 * The dashboard's Activities section: the week's best days, calendar options,
 * one card per activity for the selected day, and the add, manage and edit
 * dialogs. Guests get a sign-in prompt instead.
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
  const { activitiesLocked } = access
  const hasActivities = !activitiesLocked && prefs.activities.length > 0

  return (
    <section>
      <ActivitiesIntro
        onAdd={activitiesLocked ? undefined : () => setModal('add')}
        onManage={activitiesLocked ? undefined : () => setModal('manage')}
      />

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
            onBook={onBook}
          />
        </div>
      )}

      {hasActivities && isCalendarConfigured() && (
        <CalendarConnectBanner status={calendar.status} onConnect={() => void calendar.connect()} />
      )}

      {hasActivities && <CalendarFeed prefs={prefs} />}

      {/* The sign-in gate wins even over legacy guest activities saved before
          activities required sign-in; they still seed the account on sign-in. */}
      {activitiesLocked ? (
        <ActivityEmptyState prefs={prefs} />
      ) : prefs.activities.length > 0 ? (
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
        <ActivityEmptyState prefs={prefs} onAdd={() => setModal('add')} />
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
