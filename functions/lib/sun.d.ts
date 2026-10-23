// Type boundary for sun.js, which is not yet type-checked (it moves to TypeScript with the
// rest of functions/ in plan lane W2-B). Keep in sync with sun.js.

import type { IcsEvent } from './ics'

export interface SunForecastDay {
  dateStr: string
  hourly: Array<{ hour: number; uv: number }>
}

export function fetchForecast(
  lat: number,
  lon: number,
  days: number,
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<SunForecastDay[]>

export function buildSunEvents(user: unknown, forecast: SunForecastDay[]): IcsEvent[]
