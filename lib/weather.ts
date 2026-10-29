import { uvBand, windowEventTitle, type UVBand } from '@solara/core'
import { zonedInstant } from './time'

// Per-day activity planning lives in @solara/core (packages/core/src/weather.ts), shared
// with a native client; this module adds the web's display helpers (CSS colors, the
// Google Calendar link).
export { fmtDays, getActivityWindow, vitDMins } from '@solara/core/weather'

/** 12-hour hour and time labels; components use useUnits() for the person's clock. */
export { formatHour as fmtHour, formatClockTime as fmtClock } from './units'

export { burnMins, SKIN_BURN_BASE } from './recommendation'

/** The WHO UV scale lives in @solara/core so briefings and alerts name levels the same. */
export { UV_BANDS, formatUV, uvBand, uvLabel, type UVBand } from '@solara/core'

/**
 * The fill color of a UV value's band, as a CSS value for inline styles and SVG.
 * The palette itself is defined once, as the --color-uv-* theme variables in
 * app/globals.css; this only picks the variable.
 */
export function uvColor(uv: number): string {
  return uvBandColor(uvBand(uv))
}

/** The fill color of a UV band, as a CSS value (see uvColor). */
export function uvBandColor(band: UVBand): string {
  return `var(--color-uv-${band})`
}

/**
 * Text color on a UV fill (uvColor). Every fill is a light tint, so one
 * near-black (--color-uv-ink) reads at 4.5:1 or better on all of them, in both
 * themes.
 */
export function uvTextColor(_uv: number): string {
  return 'var(--color-uv-ink)'
}

/** Google Calendar's compact UTC timestamp, e.g. 20260615T173000Z. */
export function gcalTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/**
 * A Google Calendar "add event" link for a slot on `dateStr`, starting at the
 * fractional hour `window.from` in the forecast location's `timeZone`, so the event
 * lands at the right moment whatever zone the device is in.
 */
export function gcalLink(
  activityName: string,
  window: { from: number; to: number },
  durationMins: number,
  dateStr: string,
  timeZone: string,
): string {
  const start = zonedInstant(dateStr, window.from, timeZone)
  const end = start + Math.round(durationMins) * 60_000
  const title = encodeURIComponent(windowEventTitle(activityName))
  const details = encodeURIComponent(
    'Forecast-based lower-UV planning estimate from Solara. Recheck current UV and use sun protection.',
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gcalTimestamp(start)}/${gcalTimestamp(end)}&details=${details}`
}
