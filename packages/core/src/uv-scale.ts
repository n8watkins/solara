// The WHO UV index scale, shared by every surface that names a UV level.

/**
 * The bands of the UV index scale, lowest first. 'none' (an index of 0: night, or the
 * low sun just after sunrise and before sunset) is the app's own shade of the WHO's Low
 * band, drawn gray; it is named "Low" like the rest of the band, since the WHO scale has
 * no "None" (Low is 0-2, as the app's UV scale legend says).
 */
export const UV_BANDS = ['none', 'low', 'moderate', 'high', 'very-high', 'extreme'] as const
export type UVBand = (typeof UV_BANDS)[number]

const UV_BAND_LABELS: Record<UVBand, string> = {
  none: 'Low',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  'very-high': 'Very high',
  extreme: 'Extreme',
}

/**
 * The UV scale band of a UV value. The WHO bands (Low 0-2, Moderate 3-5, High 6-7,
 * Very high 8-10, Extreme 11+) are defined on the whole-number index, so the value
 * is rounded first: 5.4 is Moderate and 5.5 is High, as the scale legend reads.
 * Every UV color and label goes through this one function.
 */
export function uvBand(uv: number): UVBand {
  const index = Math.round(uv)
  if (index < 1) return 'none'
  if (index <= 2) return 'low'
  if (index <= 5) return 'moderate'
  if (index <= 7) return 'high'
  if (index <= 10) return 'very-high'
  return 'extreme'
}

/** The WHO category's name: "Low" (an index of 0-2), "Moderate", "High", "Very high", "Extreme". */
export function uvLabel(uv: number): string {
  return UV_BAND_LABELS[uvBand(uv)]
}

/**
 * How every UV value is written, in the app, the alerts, the calendar feed and the city
 * pages: one decimal, as the forecast gives it ("10.3", "6.0"), so the same hour or
 * peak never reads as two numbers in two places (REVIEW4 L5). Bands and thresholds
 * still read the whole-number index (`uvBand`).
 */
export function formatUV(uv: number): string {
  const rounded = Math.round(uv * 10) / 10
  return (rounded === 0 ? 0 : rounded).toFixed(1)
}
