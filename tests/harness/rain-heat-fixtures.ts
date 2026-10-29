// Forecasts with rain and heat (packages/core/src/weather-fit.ts) on the default
// harness day. The UV is the default fixture's; only the chance of rain and the
// feels-like temperature differ, so whatever moves on screen moved for the weather.
//
//   rain-heat  today: rain likely 6pm-7pm (the start of Running's lower-UV evening, so its
//              slot moves to 7pm) and a feels-like 34°C 4pm-6pm (over Tennis's 32°C).
//   rain-late  today: rain likely from 5pm, through every lower-UV hour left, so no
//              activity has a slot; tomorrow: rain likely all day.
import { forecastView, parseForecast } from '@/lib/forecast'
import type { WeatherResponse } from '@/lib/types'
import { HARNESS_DATE, HARNESS_NOW_MS } from './clock'
import { HARNESS_LOCATION, buildRawForecast } from './fixtures'

export const RAIN_HEAT_FIXTURES = ['rain-heat', 'rain-late'] as const
export type RainHeatFixture = (typeof RAIN_HEAT_FIXTURES)[number]

export function isRainHeatFixture(name: string | null): name is RainHeatFixture {
  return (RAIN_HEAT_FIXTURES as readonly (string | null)[]).includes(name)
}

const TOMORROW = '2026-06-16'

const WEATHER: Record<RainHeatFixture, (hour: number) => { rain: number; hotC?: number }> = {
  'rain-heat': hour => ({
    rain: hour === 18 ? 70 : 10,
    ...(hour >= 16 && hour < 18 && { hotC: 34 }),
  }),
  'rain-late': hour => ({ rain: hour >= 17 ? 80 : 10 }),
}

export function buildRainHeatWeather(
  fixture: RainHeatFixture,
  at: number = HARNESS_NOW_MS,
): WeatherResponse {
  const raw = buildRawForecast(at)
  const weather = raw.hourly.time.map(time => {
    if (time.startsWith(HARNESS_DATE)) return WEATHER[fixture](Number(time.slice(11, 13)))
    return { rain: fixture === 'rain-late' && time.startsWith(TOMORROW) ? 80 : 0 }
  })
  return forecastView(
    parseForecast(
      {
        ...raw,
        hourly: {
          ...raw.hourly,
          precipitation_probability: weather.map(w => w.rain),
          apparent_temperature: raw.hourly.temperature_2m.map(
            (temp, i) => weather[i]?.hotC ?? temp,
          ),
        },
      },
      { days: 10 },
    ),
    undefined,
    HARNESS_LOCATION,
  )
}
