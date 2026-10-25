// Forecasts whose UV peaks near either end of the day, so the sun path's
// "Peak 10.3 · 1pm" callout sits next to an edge of the arc (and, on a phone, off
// to the side of the scrolled strip). The default fixture peaks at 1pm, near the
// middle, which never exercised the callout's edge placement.
import { forecastView, parseForecast } from '@/lib/forecast'
import type { WeatherResponse } from '@/lib/types'
import { buildRawForecast } from './fixtures'

/**
 * Local hour of every day's UV peak, per fixture: the second and second-to-last
 * hours of the strip (6am-8pm). The very first and last ring would sit in a phone
 * strip's edge fade, where the callout is not judged; lib/sun-arc.test.ts covers them.
 */
export const SUN_PEAK_HOURS = { 'peak-early': 7, 'peak-late': 19 } as const

export type SunPeakFixture = keyof typeof SUN_PEAK_HOURS

export function isSunPeakFixture(name: string | null): name is SunPeakFixture {
  return name !== null && Object.hasOwn(SUN_PEAK_HOURS, name)
}

/** UV peak for each fixture day; two digits after "Peak" keep the callout at full width. */
const PEAK_UV = 10.3

export function buildSunPeakWeather(fixture: SunPeakFixture): WeatherResponse {
  const raw = buildRawForecast()
  const peakHour = SUN_PEAK_HOURS[fixture]
  const uv = raw.hourly.time.map(time => {
    const hour = Number(time.slice(11, 13))
    // A bell around the peak hour, never zero, so every daytime hour keeps a bar.
    const value = PEAK_UV * Math.exp(-(((hour - peakHour) / 4) ** 2))
    return Math.max(0.1, Math.round(value * 10) / 10)
  })
  return forecastView(
    parseForecast(
      {
        ...raw,
        current: { ...raw.current, uv_index: null },
        hourly: { ...raw.hourly, uv_index: uv },
      },
      { days: 10 },
    ),
  )
}
