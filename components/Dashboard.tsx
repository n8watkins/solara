'use client'
import { useEffect, useEffectEvent, useState } from 'react'
import type { User } from 'firebase/auth'
import type {
  Activity,
  WeatherResponse,
  UserPreferences,
  DayWeather,
  TierLevel,
  HourlyForecast,
} from '@/lib/types'
import { useUnits } from '@/lib/use-units'
import { useFlashMessage } from '@/lib/use-flash-message'
import { useCalendarBusy } from '@/lib/use-calendar-busy'
import { nowHourOf, planActivityDay, soonestPlan } from '@/lib/next-slot'
import { busyByDate, dashboardAccess, dayPhrase, uvReadout } from '@/lib/dashboard-view'
import { buildEventDescription } from '@/lib/gcal'
import type { SlotRecommendation } from '@/lib/scheduler'
import { useScheduled } from '@/lib/scheduled-context'
import TipCarousel from './TipCarousel'
import PricingModal from './PricingModal'
import ActivitiesSection from './dashboard/ActivitiesSection'
import DayPicker from './dashboard/DayPicker'
import ExposureMetrics from './dashboard/ExposureMetrics'
import HeroSlot from './dashboard/HeroSlot'
import ScheduledDetails from './dashboard/ScheduledDetails'
import UVCard from './dashboard/UVCard'

interface Props {
  /** The signed-in account, for checkout from the Pro plans dialog. */
  user?: User | null
  weather: WeatherResponse
  prefs: UserPreferences
  displayTier?: TierLevel
  onPrefsUpdate: (prefs: UserPreferences) => void
  onRefresh: () => void
  selectedDay: DayWeather | null
  onSelectDay: (day: DayWeather | null) => void
}

export default function Dashboard({
  user,
  weather,
  prefs,
  displayTier,
  onPrefsUpdate,
  onRefresh,
  selectedDay,
  onSelectDay,
}: Props) {
  const status = useFlashMessage()
  const [showPricing, setShowPricing] = useState(false)
  // The hour being inspected, shared by the sun path and the UV strip so a tap on
  // either keeps both in sync. null falls back to "now" (today) or the day's peak.
  const [focusedHour, setFocusedHour] = useState<HourlyForecast | null>(null)
  const fmt = useUnits()
  const scheduled = useScheduled()
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  // "Now" is the forecast location's wall clock, never the device's. The
  // fractional "now" (rounded up to 5 minutes) is the earliest start any
  // recommendation on today may offer, and where the sun sits on the arc.
  const nowHour = nowHourOf(weather.now)

  const access = dashboardAccess(weather, prefs, displayTier, selectedDay)
  const { activitiesLocked, accessibleDays, visibleForecast } = access
  const day = access.selectedDay
  const calendar = useCalendarBusy(accessibleDays)

  const hourly = day ? day.hourly : weather.today
  const isToday = !day

  // Switching days clears the scrubbed hour so the arc and strip snap back to
  // "now" (or the new day's peak) rather than pointing at a stale hour.
  const activeDayKey = day?.dateStr ?? 'today'
  const [focusDayKey, setFocusDayKey] = useState(activeDayKey)
  if (focusDayKey !== activeDayKey) {
    setFocusDayKey(activeDayKey)
    setFocusedHour(null)
  }
  // Guard against a focus left over from another day's array identity.
  const focused = focusedHour && hourly.includes(focusedHour) ? focusedHour : null
  const readout = uvReadout(weather, hourly, isToday, focused, prefs.skinType, fmt.hour)
  const { peakUV, peakHour } = readout

  const dateLabel = day?.label ?? 'Today'
  const activeDateStr = day?.dateStr ?? weather.forecast[0]?.dateStr ?? ''
  const busy = busyByDate(calendar.busy, visibleForecast, weather.timezone)
  // One plan per activity for the selected day; the hero, the cards and their share
  // and calendar buttons all read from it, and PlanAhead runs the same function.
  const dayPlans = prefs.activities.map(a =>
    planActivityDay(hourly, a, prefs.skinType, {
      nowHour: isToday ? nowHour : -1,
      busy: busy[activeDateStr] ?? [],
    }),
  )
  const heroPlan = soonestPlan(dayPlans)
  const allElapsed = isToday && dayPlans.some(p => p.elapsed) && !heroPlan
  const hasActivities = !activitiesLocked && prefs.activities.length > 0

  // Scheduled activities are checked against Google when a token is already in memory.
  const scheduledEnabled = scheduled.enabled
  const refreshScheduled = useEffectEvent(() => void scheduled.refresh({ interactive: false }))
  useEffect(() => {
    if (scheduledEnabled) refreshScheduled()
  }, [scheduledEnabled])

  async function bookSlotOn(activity: Activity, rec: SlotRecommendation, dateStr: string) {
    status.hold('Adding to your Google Calendar…')
    // For a future day the "peak" context belongs to that day, not today's reading.
    const peak = dateStr === activeDateStr ? { peakUV, peakHour } : { peakUV: rec.peakUV }
    try {
      await scheduled.schedule({
        activity,
        dateStr,
        slot: rec,
        description: buildEventDescription(rec, activity, peak),
        timeZone: weather.timezone,
      })
      status.flash(
        `✓ Scheduled ${activity.name} for ${fmt.time(rec.start)}. It is on your Google Calendar.`,
      )
    } catch {
      status.flash('Could not add to Google Calendar. Nothing was saved; try again.')
    }
  }

  // The scheduled event whose details are open; it closes when the event goes away.
  const openItem = openEventId
    ? (scheduled.items.find(item => item.eventId === openEventId) ?? null)
    : null

  if (!hourly.length) {
    return (
      <div className="card p-12 text-center">
        <p className="mb-2 text-[34px]">🌙</p>
        <p className="mb-1 text-[16px] font-semibold text-ink">No UV data for this period</p>
        <p className="text-[14px] text-ink-3">UV data is available between 6am and 8pm.</p>
      </div>
    )
  }

  return (
    <div className="dash-stack">
      <DayPicker access={access} onSelectDay={onSelectDay} onRefresh={onRefresh} />

      {status.message && (
        <div
          role="status"
          className="rounded-[10px] border-[0.5px] border-brand/20 bg-brand/8 px-[13px] py-[11px] text-[13px] text-ink-2"
        >
          {status.message}
        </div>
      )}

      {hasActivities && (
        <HeroSlot
          plan={heroPlan}
          isToday={isToday}
          dateLabel={dateLabel}
          allElapsed={allElapsed}
          dayPhrase={dayPhrase(isToday, dateLabel)}
          peakUV={peakUV}
          peakHour={peakHour}
        />
      )}

      <UVCard
        hourly={hourly}
        readout={readout}
        currentHour={isToday ? weather.now.hour : -1}
        nowHour={isToday ? nowHour : null}
        focused={focused}
        onSelectHour={setFocusedHour}
        showSunPath={process.env.NEXT_PUBLIC_HIDE_SUNPATH !== '1' && prefs.showSunPath !== false}
      />

      <ExposureMetrics
        burn={readout.burn}
        vitD={readout.vitD}
        isToday={isToday}
        skinType={prefs.skinType}
      />

      <TipCarousel />

      <ActivitiesSection
        prefs={prefs}
        weather={weather}
        access={access}
        plans={dayPlans}
        isToday={isToday}
        dateStr={activeDateStr}
        dateLabel={dateLabel}
        nowHour={nowHour}
        busyByDate={busy}
        calendar={calendar}
        onBook={scheduled.enabled ? (a, r, d) => void bookSlotOn(a, r, d) : undefined}
        scheduledItems={scheduled.items}
        onOpenScheduled={item => setOpenEventId(item.eventId)}
        onUpgrade={() => setShowPricing(true)}
        onPrefsUpdate={onPrefsUpdate}
      />

      {openItem && (
        <ScheduledDetails
          key={openItem.eventId}
          item={openItem}
          prefs={prefs}
          weather={weather}
          nowHour={nowHour}
          onClose={() => setOpenEventId(null)}
          onDone={message => status.flash(message)}
        />
      )}

      {showPricing && (
        <PricingModal
          user={user}
          email={user?.email ?? prefs.upgradeInterest?.email}
          alreadyWaitlisted={!!prefs.upgradeInterest}
          onJoinWaitlist={email =>
            onPrefsUpdate({
              ...prefs,
              upgradeInterest: { email: email || undefined, createdAt: new Date().toISOString() },
            })
          }
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  )
}
