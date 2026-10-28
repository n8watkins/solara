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
import { useStatusFlash } from '@/hooks/useStatusFlash'
import { useCalendarBusy } from '@/hooks/useCalendarBusy'
import { nowHourOf, planActivityDay, soonestPlan } from '@/lib/next-slot'
import { nextSlotAfterToday } from '@/lib/planner'
import {
  busyByDate,
  dashboardAccess,
  dayHourText,
  dayPhrase,
  nextHourWhere,
  sunDown,
  uvReadout,
} from '@/lib/dashboard-view'
import { briefingView } from '@/lib/briefing-view'
import { buildEventDescription } from '@/lib/gcal-view'
import type { SlotRecommendation } from '@/lib/scheduler'
import { useScheduled } from '@/lib/scheduled-context'
import { PricingModal, SunscreenTimer } from './deferred'
import ActivitiesSection from './dashboard/ActivitiesSection'
import DailyBriefing from './dashboard/DailyBriefing'
import DayPicker from './dashboard/DayPicker'
import ExposureMetrics from './dashboard/ExposureMetrics'
import { planningFor } from '@/lib/profiles'
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
  const status = useStatusFlash(4500)
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
  const { accessibleDays, visibleForecast } = access
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
  // One person's skin type, or a group's most sensitive (lib/profiles.ts planningFor).
  const planning = planningFor(prefs)
  const readout = uvReadout(weather, hourly, isToday, focused, planning.skinType, fmt.hour)
  const { peakUV, peakHour } = readout

  const dateLabel = day?.label ?? 'Today'
  const activeDateStr = day?.dateStr ?? weather.forecast[0]?.dateStr ?? ''
  const busy = busyByDate(calendar.busy, visibleForecast, weather.timezone)
  // One plan per activity for the selected day; the hero, the cards and their share
  // and calendar buttons all read from it, and PlanAhead runs the same function.
  const dayPlans = prefs.activities.map(a =>
    planActivityDay(hourly, a, planning.skinType, {
      nowHour: isToday ? nowHour : -1,
      busy: busy[activeDateStr] ?? [],
    }),
  )
  const heroPlan = soonestPlan(dayPlans)
  const allElapsed = isToday && dayPlans.some(p => p.elapsed) && !heroPlan
  // Once today is done, the hero names the next slot the plan can see (never a
  // section the plan does not show).
  const laterDaysVisible = accessibleDays > 1
  const hasActivities = prefs.activities.length > 0
  const nextSlot = allElapsed
    ? nextSlotAfterToday(
        weather.forecast,
        prefs.activities,
        planning.skinType,
        accessibleDays,
        busy,
      )
    : null
  // After dark (or before sunrise) today: the readout and metrics say so and when UV
  // comes back, instead of a bare "0.0 None" and dashes.
  const down = isToday ? sunDown(weather, nowHour) : null
  // The briefing names the day's peak and best window; after dark it briefs
  // tomorrow and leads the dashboard in place of the hero, which has nothing left today.
  const briefing = briefingView({
    weather,
    selectedDay: day,
    nowHour,
    activities: prefs.activities,
    skinType: prefs.skinType,
    laterDaysVisible,
    city: prefs.location?.city ?? '',
    formatTime: fmt.time,
  })
  const showHero = hasActivities && down?.phase !== 'after-sunset'
  const fromHour = (test: (uv: number) => boolean) => {
    const at = isToday ? nextHourWhere(weather, nowHour, test) : null
    return at ? dayHourText(at, fmt.hour) : null
  }
  // Every upsell opens the same plans dialog.
  const openPlans = () => setShowPricing(true)

  // Scheduled activities are checked against Google when a token is already in memory.
  const scheduledEnabled = scheduled.enabled
  const refreshScheduled = useEffectEvent(() => void scheduled.refresh({ interactive: false }))
  useEffect(() => {
    if (scheduledEnabled) refreshScheduled()
  }, [scheduledEnabled])

  async function bookSlotOn(activity: Activity, rec: SlotRecommendation, dateStr: string) {
    // Shown until the result replaces it; the minute is only a safety net.
    status.flash('Adding to your Google Calendar…', 60_000)
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
      <DayPicker
        access={access}
        onSelectDay={onSelectDay}
        onRefresh={onRefresh}
        onUpgrade={openPlans}
      />

      {status.message && (
        <div
          role="status"
          className="rounded-[10px] border-[0.5px] border-brand/20 bg-brand/8 px-[13px] py-[11px] text-[13px] text-ink-2"
        >
          {status.message}
        </div>
      )}

      <DailyBriefing view={briefing} onSignIn={openPlans} />

      {/* From 1024 px the conditions (left) and the activity plan (right) sit side by
          side; narrower, both columns stack in this order. */}
      <div className="dash-columns">
        <div className="dash-col">
          {showHero && (
            <HeroSlot
              plan={heroPlan}
              isToday={isToday}
              dateLabel={dateLabel}
              allElapsed={allElapsed}
              dayPhrase={dayPhrase(isToday, dateLabel)}
              next={nextSlot}
              laterDaysVisible={laterDaysVisible}
              onPlanTomorrow={openPlans}
              onMorningAlert={access.activityTier === 'paid' ? undefined : openPlans}
            />
          )}

          <UVCard
            hourly={hourly}
            readout={readout}
            currentHour={isToday ? weather.now.hour : -1}
            nowHour={isToday ? nowHour : null}
            focused={focused}
            sunDown={down}
            onSelectHour={setFocusedHour}
            showSunPath={
              process.env.NEXT_PUBLIC_HIDE_SUNPATH !== '1' && prefs.showSunPath !== false
            }
          />

          <ExposureMetrics
            burn={readout.burn}
            vitD={readout.vitD}
            isToday={isToday}
            skinType={planning.skinType}
            mostSensitive={planning.mostSensitive?.name}
            burnFrom={readout.burn === null ? fromHour(uv => uv >= 0.5) : null}
            vitDFrom={readout.vitD === null ? fromHour(uv => uv >= 1) : null}
          />

          {isToday && down?.phase !== 'after-sunset' && <SunscreenTimer />}
        </div>

        <div className="dash-col">
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
            onUpgrade={openPlans}
            onPrefsUpdate={onPrefsUpdate}
          />
        </div>
      </div>

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

      {/* The one caveat on the dashboard (the metric tooltips carry their own). */}
      <p className="mx-0.5 text-[11px] leading-normal text-ink-3">
        Forecast-based planning estimates, not medical advice. Conditions can change; use sun
        protection.
      </p>

      {showPricing && (
        <PricingModal
          user={user}
          email={user?.email ?? prefs.upgradeInterest?.email}
          alreadyWaitlisted={!!prefs.upgradeInterest}
          onJoinWaitlist={
            user
              ? email =>
                  onPrefsUpdate({
                    ...prefs,
                    upgradeInterest: {
                      email: email || undefined,
                      createdAt: new Date().toISOString(),
                    },
                  })
              : undefined
          }
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  )
}
