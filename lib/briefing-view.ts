// What the dashboard's briefing card shows (components/dashboard/DailyBriefing.tsx):
// which day it briefs, whether the plan may see that day, and the share text. The
// words come from the shared briefing in @solara/core.
import { briefingDay, dailyBriefing, type DailyBriefing } from '@solara/core'
import type { Activity, DayWeather, SkinType, WeatherResponse } from './types'
import { addDays } from './time'

export interface DailyBriefingView {
  /** "Today at a glance", "Tomorrow at a glance", "Wed, Jun 17 at a glance". */
  heading: string
  briefing: DailyBriefing
  /** The briefed day is beyond the plan (a guest after dark): offer sign-in instead. */
  locked: boolean
  shareTitle: string
  shareText: string
}

export interface BriefingViewInput {
  weather: Pick<WeatherResponse, 'now' | 'today' | 'tomorrow'>
  /** A later day picked in the day picker, else null (today). */
  selectedDay: Pick<DayWeather, 'dateStr' | 'label' | 'hourly'> | null
  /** Fractional "now" in the forecast's zone (lib/next-slot.ts nowHourOf). */
  nowHour: number
  activities: readonly Activity[]
  skinType: SkinType
  /** The plan shows days after today (false on the guest plan). */
  laterDaysVisible: boolean
  city: string
  formatTime: (hours: number) => string
}

/**
 * The selected day's briefing, or with today selected: today's, or tomorrow's once
 * no UV is left today.
 */
export function briefingView({
  weather,
  selectedDay,
  nowHour,
  activities,
  skinType,
  laterDaysVisible,
  city,
  formatTime,
}: BriefingViewInput): DailyBriefingView {
  const picked = selectedDay
    ? {
        day: { date: selectedDay.dateStr, hourly: selectedDay.hourly },
        which: 'later' as const,
      }
    : briefingDay(
        { date: weather.now.date, hourly: weather.today },
        { date: addDays(weather.now.date, 1), hourly: weather.tomorrow },
        nowHour,
      )
  const dayWord =
    picked.which === 'today'
      ? 'Today'
      : picked.which === 'tomorrow'
        ? 'Tomorrow'
        : selectedDay!.label
  const input = {
    day: picked.day,
    nowHour: picked.which === 'today' ? nowHour : null,
    activities,
    skinType,
    formatTime,
  }
  const where = city ? ` in ${city}` : ''
  return {
    heading: `${dayWord} at a glance`,
    briefing: dailyBriefing({ ...input, dayLabel: dayWord }),
    locked: picked.which === 'tomorrow' && !laterDaysVisible,
    shareTitle: `${dayWord} at a glance - Solara`,
    shareText: dailyBriefing({ ...input, dayLabel: `${dayWord}${where}` }).text,
  }
}
