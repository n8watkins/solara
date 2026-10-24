import type { UVBand } from '@/lib/weather'
import type { UVNumberTone } from '@/lib/dashboard-view'

// Tailwind classes for the UV palette (the --color-uv-* theme in app/globals.css).
// Written out in full so Tailwind's scanner finds every class.

/** Fill of a UV band; text on it is text-uv-ink. */
export const UV_BG: Record<UVBand, string> = {
  none: 'bg-uv-none',
  low: 'bg-uv-low',
  moderate: 'bg-uv-moderate',
  high: 'bg-uv-high',
  'very-high': 'bg-uv-very-high',
  extreme: 'bg-uv-extreme',
}

/** Text color of the dashboard's big UV number (AA in both themes). */
export const UV_NUMBER_TEXT: Record<UVNumberTone, string> = {
  none: 'text-ink-3',
  success: 'text-success',
  warning: 'text-warning',
  accent: 'text-accent',
  danger: 'text-danger',
}
