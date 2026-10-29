import { planningFor } from '@solara/core'
import type { UserPreferences, WeatherResponse } from '@/lib/types'
import type { ScheduledActivity } from '@/lib/scheduled'
import { scheduledSpan } from '@/lib/scheduled-view'
import { planActivityDay } from '@solara/core/next-slot'
import { activityColor } from '@/lib/activity-colors'
import { ScheduledSheet } from '../deferred'

/** The open scheduled event's sheet, with that day's windows for changing its time. */
export default function ScheduledDetails({
  item,
  prefs,
  weather,
  nowHour,
  onClose,
  onDone,
}: {
  item: ScheduledActivity
  prefs: UserPreferences
  weather: WeatherResponse
  /** Fractional "now" on the forecast's today. */
  nowHour: number
  onClose: () => void
  onDone: (message: string) => void
}) {
  const activity = prefs.activities.find(a => a.id === item.activityId)
  const date = scheduledSpan(item, weather.timezone).date
  const day = weather.forecast.find(d => d.dateStr === date)
  const dayNowHour = date === weather.now.date ? nowHour : -1
  return (
    <ScheduledSheet
      item={item}
      activity={activity}
      color={activityColor(prefs.activities, item.activityId)}
      timeZone={weather.timezone}
      dayLabel={day?.label ?? date}
      windows={
        activity && day
          ? planActivityDay(day.hourly, activity, planningFor(prefs).skinType, {
              nowHour: dayNowHour,
              daylight: day.daylight,
            }).windows
          : []
      }
      nowHour={dayNowHour}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
