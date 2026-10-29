// Rain and heat: the hours an activity skips even when their UV suits it. Open-Meteo's
// hourly `precipitation_probability` and `apparent_temperature` (the "feels like"
// temperature, which counts humidity and wind) come with the same forecast request, so
// every planner (the app, the briefing, the morning alert and the calendar feed) judges
// an hour the same way. Pure and small: it is part of every planning bundle.
//
// Each activity has an "avoid rain" switch and a "max feels-like" limit. Left unset,
// they follow the activity's defaults (weatherDefaults): water sports go ahead in rain
// and heat, strenuous ones stop at a feels-like 32°C (about 90°F, the US National
// Weather Service's "extreme caution" band starts there), and everything else at 38°C
// (about 100°F, near its "danger" band). An hour without a value (an older cached
// forecast) is never skipped for it.

/** A chance of rain (percent) from which an hour counts as "rain likely". */
export const RAIN_LIKELY_PERCENT = 50
/** Feels-like limits (Celsius) for strenuous activities and for everything else. */
export const HEAT_LIMIT_C = Object.freeze({ strenuous: 32, other: 38 })
/** The limits the activity dialog offers, in each unit (the stored value is Celsius). */
export const FEELS_LIKE_CHOICES = Object.freeze({
  celsius: Object.freeze([26, 28, 30, 32, 35, 38, 40]),
  fahrenheit: Object.freeze([80, 85, 90, 95, 100, 105]),
})

// Preset activity ids (tiers.ts ACTIVITY_CATEGORIES); custom activities take the general default.
const RAIN_OK = new Set(['swim', 'surf'])
const HEAT_OK = new Set(['swim', 'surf', 'kayak', 'paddle'])
const STRENUOUS = new Set([
  'run',
  'jog',
  'cycle',
  'mtb',
  'sprint',
  'hike',
  'soccer',
  'tennis',
  'baseball',
  'bball',
  'golf',
  'dog',
])

/** An activity's rain and heat settings; undefined follows its defaults, null is "no limit". */
export interface WeatherSetting {
  id?: string
  avoidRain?: boolean | null
  maxFeelsLikeC?: number | null
}

/** One forecast hour's rain chance (percent) and feels-like temperature (Celsius). */
export interface WeatherHour {
  hour: number
  rainChance?: number | null
  feelsC?: number | null
}

export interface WeatherLimits {
  avoidRain: boolean
  /** Feels-like limit in Celsius, or null for none. */
  maxFeelsLikeC: number | null
}

/** What an activity does when its settings are unset, from its preset id. */
export function weatherDefaults(id: string | undefined): WeatherLimits {
  const preset = id ?? ''
  return {
    avoidRain: !RAIN_OK.has(preset),
    maxFeelsLikeC: HEAT_OK.has(preset)
      ? null
      : STRENUOUS.has(preset)
        ? HEAT_LIMIT_C.strenuous
        : HEAT_LIMIT_C.other,
  }
}

/** The limits an activity plans with: its own settings, else its defaults. */
export function weatherLimits(activity: WeatherSetting): WeatherLimits {
  const defaults = weatherDefaults(activity.id)
  return {
    avoidRain: typeof activity.avoidRain === 'boolean' ? activity.avoidRain : defaults.avoidRain,
    maxFeelsLikeC:
      activity.maxFeelsLikeC === undefined ? defaults.maxFeelsLikeC : activity.maxFeelsLikeC,
  }
}

export type WeatherKind = 'rain' | 'heat'

/** Why an activity skips this hour (rain first), or null when the weather suits it. */
export function weatherIn(
  hour: Omit<WeatherHour, 'hour'>,
  limits: WeatherLimits,
): WeatherKind | null {
  if (limits.avoidRain && (hour.rainChance ?? 0) >= RAIN_LIKELY_PERCENT) return 'rain'
  const feels = hour.feelsC
  if (limits.maxFeelsLikeC !== null && typeof feels === 'number' && feels > limits.maxFeelsLikeC)
    return 'heat'
  return null
}

/** A run of hours an activity skips for one reason, [from, to). */
export interface WeatherSpan {
  kind: WeatherKind
  from: number
  to: number
  /** For heat: the highest feels-like temperature in it (Celsius). */
  feelsC?: number
}

/**
 * The hours inside `spans` (the windows the UV alone would allow) that the weather takes
 * away, as runs of one reason each. Empty when the weather changes nothing, so the
 * screens and messages mention rain and heat only where they change the advice.
 */
export function weatherSpans(
  hourly: readonly WeatherHour[],
  limits: WeatherLimits,
  spans: readonly { from: number; to: number }[],
): WeatherSpan[] {
  const out: WeatherSpan[] = []
  for (const h of hourly) {
    if (!spans.some(s => h.hour + 1 > s.from && h.hour < s.to)) continue
    const kind = weatherIn(h, limits)
    if (!kind) continue
    const last = out.at(-1)
    const feels = kind === 'heat' ? (h.feelsC as number) : undefined
    if (last && last.kind === kind && last.to === h.hour) {
      last.to = h.hour + 1
      if (feels !== undefined) last.feelsC = Math.max(last.feelsC ?? feels, feels)
    } else {
      out.push({
        kind,
        from: h.hour,
        to: h.hour + 1,
        ...(feels !== undefined && { feelsC: feels }),
      })
    }
  }
  return out
}

/** "Rain likely 2pm–4pm", "Too hot 1pm–5pm, feels like 97°F". */
export function weatherText(
  span: WeatherSpan,
  formatTime: (hours: number) => string,
  formatTemp: (celsius: number) => string,
): string {
  const range = `${formatTime(span.from)}–${formatTime(span.to)}`
  return span.kind === 'rain'
    ? `Rain likely ${range}`
    : `Too hot ${range}, feels like ${formatTemp(span.feelsC ?? 0)}`
}

/** A Celsius reading in a unit, rounded to a whole degree: "29°C", "84°F". */
export function formatTemperature(celsius: number, unit: 'celsius' | 'fahrenheit'): string {
  if (!Number.isFinite(celsius)) return '--'
  const value = Math.round(unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius)
  // Never print "-0°".
  return `${value === 0 ? 0 : value}°${unit === 'fahrenheit' ? 'F' : 'C'}`
}
