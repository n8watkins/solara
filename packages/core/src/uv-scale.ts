// The WHO UV index scale, shared by every surface that names a UV level.

/** The bands of the UV index scale, lowest first. */
export const UV_BANDS = ['none', 'low', 'moderate', 'high', 'very-high', 'extreme'] as const
export type UVBand = (typeof UV_BANDS)[number]

const UV_BAND_LABELS: Record<UVBand, string> = {
  none: 'None',
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

/** The band's name: "Low", "Very high". */
export function uvLabel(uv: number): string {
  return UV_BAND_LABELS[uvBand(uv)]
}
