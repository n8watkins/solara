// The shared words of @solara/core: UV categories, durations, the clock, weekdays, rain
// and heat, and forecast confidence. English, the source of truth; translations are in
// ./es (docs/i18n/README.md).
import { defineMessages } from '../i18n'

export default defineMessages('core', {
  // The WHO UV index categories.
  uvLow: 'Low',
  uvModerate: 'Moderate',
  uvHigh: 'High',
  uvVeryHigh: 'Very high',
  uvExtreme: 'Extreme',

  // Durations: "45 min", "2 h", "2 h 47 min" (never "167m", which reads as metres).
  minutes: (m: number) => `${m} min`,
  hours: (h: number) => `${h} h`,
  hoursMinutes: (h: number, m: number) => `${h} h ${m} min`,

  // The 12-hour clock: "9am", "6:45am"; the narrowest label for the hourly strip: "6a".
  clock12: (time: string, pm: boolean) => `${time}${pm ? 'pm' : 'am'}`,
  clock12Compact: (hour: string, pm: boolean) => `${hour}${pm ? 'p' : 'a'}`,

  weekdaysShort: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  /** Joins choices: "a, b or c". */
  listOr: (items: string[]) =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`,
  /** Joins a list: "a, b and c". */
  listAnd: (items: string[]) =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`,

  // Rain and heat (weather-fit.ts).
  rainLikely: (range: string) => `Rain likely ${range}`,
  tooHot: (range: string, feels: string) => `Too hot ${range}, feels like ${feels}`,

  // Forecast quality (forecast-quality.ts).
  confidenceFair: 'Fair confidence: UV and the best times can still change',
  confidenceLow: 'Low confidence: a rough guide, check again closer to the day',
  cloudNote: (uv: string, clearSky: string) =>
    `Clouds may cut UV to ${uv} from a clear-sky ${clearSky}`,

  // The hourly strip's description for screen readers (uv-strip.ts).
  stripNoForecast: 'No UV forecast for this day.',
  stripPeak: (uv: string, label: string, time: string) =>
    `UV peaks at ${uv}, ${label}, at ${time}.`,
  stripHighAt: (time: string) => `High or above at ${time}.`,
  stripHighFromTo: (from: string, to: string) => `High or above from ${from} to ${to}.`,
  stripNoDataAt: (time: string) => `No UV data at ${time}.`,
  stripNoDataFromTo: (from: string, to: string) => `No UV data from ${from} to ${to}.`,

  // Days (day-view.ts and the app's day labels).
  today: 'Today',
  tomorrow: 'Tomorrow',
  /** In a sentence: "Next slot: today at 9am". */
  todayLower: 'today',
  tomorrowLower: 'tomorrow',
  /** "on Wed, Jun 17" in a sentence. */
  onDate: (date: string) => `on ${date}`,
  /** "7am tomorrow". */
  timeTomorrow: (time: string) => `${time} tomorrow`,
  yesterdayAt: (time: string) => `yesterday, ${time}`,
  dateAt: (date: string, time: string) => `${date}, ${time}`,

  // Weather conditions (forecast.ts WEATHER_LABELS), shown by weatherConditionText.
  conditionClear: 'Clear',
  conditionPartlyCloudy: 'Partly cloudy',
  conditionFoggy: 'Foggy',
  conditionRainy: 'Rainy',
  conditionSnowy: 'Snowy',
  conditionShowers: 'Showers',
  conditionStormy: 'Stormy',
  conditionUnknown: 'Unknown',

  // Parts of the day a window covers (recommendation.ts labelWindow).
  windowMorning: 'Morning',
  windowMidday: 'Midday',
  windowAfternoon: 'Afternoon',
  windowEvening: 'Evening',
  windowAllDay: 'All day',

  // Skin types by name (recommendation.ts SkinType), and "fair skin".
  skinVeryFair: 'very fair',
  skinFair: 'fair',
  skinMedium: 'medium',
  skinOlive: 'olive',
  skinDark: 'dark',
  skinOf: (name: string) => `${name} skin`,

  /** The name of an activity saved without one. */
  defaultActivityName: 'Outdoor activity',
  newerSettings: (schema: number) =>
    `These settings were saved by a newer version of Solara (schema ${schema}). Reload to update before changing them.`,
  /** A calendar event's title for an activity window. */
  windowEventTitle: (activity: string) => `${activity}: lower-UV window`,

  // Why a slot was picked (scheduler.ts), with a window's part of the day in lower case.
  reasonLatest: (part: string) => `Latest matching spot in your ${part} window`,
  reasonSunniest: 'Your sunniest available window within the planning limit',
  reasonEarliest: (part: string) => `Earliest free spot in your ${part} window`,
  /** The part of the day for "All day" in those reasons. */
  reasonAllDayPart: 'lower-UV',
})
