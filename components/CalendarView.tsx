'use client'
import { planningSkinType } from '@/lib/profiles'
import { Lock } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import type { Activity, UserPreferences, WeatherResponse } from '@/lib/types'
import { canUseCalendar, getFutureDays, TIER_LIMITS } from '@/lib/tiers'
import { nowHourOf } from '@/lib/next-slot'
import { formatDate, fractionalHour } from '@/lib/time'
import { useUnits } from '@/lib/use-units'
import {
  computeAxis,
  computeColumns,
  pageTarget,
  rangeLabel,
  visibleDays,
  type ViewKey,
} from '@/lib/calendar-layout'
import { calendarDays, hasUVGaps, planCalendarDays, scheduledDetail } from '@/lib/calendar-grid'
import { activityColor } from '@/lib/activity-colors'
import { useScheduled } from '@/lib/scheduled-context'
import { useStatusFlash } from '@/hooks/useStatusFlash'
import CalendarEmpty from './calendar/CalendarEmpty'
import CalendarLegend from './calendar/CalendarLegend'
import CalendarToolbar from './calendar/CalendarToolbar'
import CalendarWeekGrid from './calendar/CalendarWeekGrid'
import CalendarWindowSheet from './calendar/CalendarWindowSheet'
import { useGridViewport } from './calendar/useGridViewport'
import { useWindowSheet } from './calendar/useWindowSheet'
import ScheduledList from './ScheduledList'
import { EditActivityModal, ScheduledSheet } from './deferred'

interface Props {
  prefs: UserPreferences
  /** The forecast as seen now in the location's zone (see lib/forecast.ts forecastView). */
  weather: WeatherResponse
  displayTier?: UserPreferences['tier']
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

const notice =
  'mb-2.5 rounded-[10px] border-[0.5px] border-notice-border bg-notice px-3 text-notice-ink'

/** The Calendar tab: every activity's lower-UV windows across the forecast days. */
export default function CalendarView({ prefs, weather, displayTier, onPrefsUpdate }: Props) {
  const tier = displayTier || prefs.tier || 'anonymous'
  const fmt = useUnits()
  const days = calendarDays(weather, getFutureDays(tier))
  const [view, setView] = useState<ViewKey>('full')
  const [focusedActivityId, setFocusedActivityId] = useState<string>('all')
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  const { gridRef, width, scrollLeft, onScroll, scrollToLeft } = useGridViewport(
    `${view}:${focusedActivityId}`,
  )
  const { selected, sheetRef, close, dismiss, toggle, chipRef } = useWindowSheet()
  const status = useStatusFlash()
  const scheduled = useScheduled()

  // Opening the calendar checks Solara's events in Google, when a token is already
  // in memory; without one, saved items show with a "Reconnect to sync" hint.
  const scheduledEnabled = scheduled.enabled
  const refreshScheduled = useEffectEvent(() => void scheduled.refresh({ interactive: false }))
  useEffect(() => {
    if (scheduledEnabled) refreshScheduled()
  }, [scheduledEnabled])

  if (!prefs.activities.length) return <CalendarEmpty />

  const visibleActivities =
    focusedActivityId === 'all'
      ? prefs.activities
      : prefs.activities.filter(a => a.id === focusedActivityId)
  const editingActivity = editingActivityId
    ? (prefs.activities.find(a => a.id === editingActivityId) ?? null)
    : null
  const lockedCopy =
    tier === 'anonymous'
      ? 'Sign in to see tomorrow in Calendar.'
      : tier === 'free'
        ? 'Go Pro for the full 10-day Calendar view.'
        : null

  const colorFor = (act: Pick<Activity, 'id'>) => activityColor(prefs.activities, act.id)
  const dayLabel = (dateStr: string) =>
    days.find(d => d.dateStr === dateStr)?.label ??
    formatDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' })

  // "Now" is the forecast location's wall clock, never the device's.
  const nowFrac = fractionalHour(weather.now)
  // The earliest start offered today (now, rounded up to 5 minutes).
  const todayNowHour = nowHourOf(weather.now)
  const planning = { skinType: planningSkinType(prefs), timeZone: weather.timezone, todayNowHour }
  const plans = planCalendarDays(days, visibleActivities, {
    ...planning,
    colorFor,
    scheduledItems: scheduled.items,
  })

  // Full day starts at the earliest window and ends at the latest, so nothing opens
  // cut off; the other views are fixed zooms.
  const allWindows = plans.flatMap(d => d.lanes.flatMap(l => l.windows))
  const axis = computeAxis(view, allWindows, prefs.calendarHours)
  const columns = computeColumns(width, days.length, visibleActivities.length)
  const { first, last } = visibleDays(scrollLeft, columns, days.length)

  // The scheduled activity whose details are open. It closes by itself when the event
  // goes away (removed here, on another device, or in Google Calendar).
  const openItem = openEventId
    ? (scheduled.items.find(i => i.eventId === openEventId) ?? null)
    : null
  const open = openItem && scheduledDetail(openItem, prefs.activities, days, planning)

  function openScheduled(eventId: string) {
    dismiss()
    setOpenEventId(eventId)
  }

  function updateActivity(updated: Activity) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({
      ...prefs,
      activities: prefs.activities.map(a => (a.id === updated.id ? updated : a)),
    })
    setEditingActivityId(null)
  }

  function deleteActivity(id: string) {
    if (!onPrefsUpdate) return
    onPrefsUpdate({ ...prefs, activities: prefs.activities.filter(a => a.id !== id) })
    setEditingActivityId(null)
    dismiss()
  }

  return (
    <div>
      <ScheduledList
        activities={prefs.activities}
        timeZone={weather.timezone}
        nowMs={weather.now.epochMs}
        dayLabel={dayLabel}
        onOpen={item => openScheduled(item.eventId)}
      />

      <CalendarToolbar
        activities={prefs.activities}
        activityId={focusedActivityId}
        onActivity={id => {
          setFocusedActivityId(id)
          dismiss()
        }}
        view={view}
        onView={next => {
          setView(next)
          dismiss()
        }}
        pager={
          days.length > columns.daysAcross
            ? {
                label: rangeLabel(days[first]?.dateStr, days[last]?.dateStr),
                canBack: first > 0,
                canForward: last < days.length - 1,
                onPage: direction =>
                  scrollToLeft(
                    pageTarget(first, direction, columns.daysAcross, days.length) * columns.colW,
                  ),
              }
            : null
        }
      />

      {lockedCopy && days.length > 0 && days.length < TIER_LIMITS.paid.futureDays && (
        <div className={`${notice} flex items-center gap-1.5 py-[9px] text-[13px]`}>
          <Lock size={14} className="shrink-0" /> {lockedCopy}
        </div>
      )}

      {status.message && (
        <div role="status" className={`${notice} py-2 text-[12px]`}>
          {status.message}
        </div>
      )}

      <CalendarWeekGrid
        plans={plans}
        axis={axis}
        columns={columns}
        gridRef={gridRef}
        onScroll={onScroll}
        fmt={fmt}
        nowFrac={nowFrac}
        todayNowHour={todayNowHour}
        selectedKey={selected?.key}
        openEventId={openEventId}
        chipRef={chipRef}
        onToggleWindow={toggle}
        onOpenScheduled={openScheduled}
      />

      <CalendarLegend
        activities={prefs.activities}
        colorFor={colorFor}
        showNoData={hasUVGaps(days, axis)}
      />

      <p className="mt-2.5 text-[11px] leading-[1.45] text-ink-3">
        Select a window to share it or add it to your calendar. Forecast-based planning estimate
        only; recheck current UV and use appropriate sun protection.
      </p>

      {selected && (
        <CalendarWindowSheet
          ref={sheetRef}
          selection={selected}
          color={colorFor(selected.act)}
          location={prefs.location}
          timeZone={weather.timezone}
          canUseCalendar={canUseCalendar(tier)}
          status={status}
          onClose={close}
          onEdit={onPrefsUpdate && (() => setEditingActivityId(selected.act.id))}
        />
      )}

      {open && (
        <ScheduledSheet
          key={open.item.eventId}
          item={open.item}
          activity={open.activity}
          color={colorFor({ id: open.item.activityId })}
          timeZone={weather.timezone}
          dayLabel={dayLabel(open.dateStr)}
          windows={open.windows}
          nowHour={open.dateStr === weather.now.date ? todayNowHour : -1}
          onClose={() => setOpenEventId(null)}
          onDone={message => status.flash(message, 5000)}
        />
      )}

      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onSave={updateActivity}
          onDelete={deleteActivity}
          onClose={() => setEditingActivityId(null)}
        />
      )}
    </div>
  )
}
