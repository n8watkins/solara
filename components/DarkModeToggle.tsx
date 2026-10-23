'use client'
import { useId, useSyncExternalStore } from 'react'
import {
  THEME_PREFERENCES,
  getThemePreference,
  setThemePreference,
  subscribeToTheme,
  type ThemePreference,
} from '@/lib/theme'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

// The static export renders the default; the stored choice takes over during
// hydration without a mismatch.
const getServerPreference = (): ThemePreference => 'system'

/**
 * System / Light / Dark theme picker: a segmented control built on native radio
 * inputs, so arrow keys, focus and screen-reader semantics come for free.
 */
export default function DarkModeToggle({ label = 'Theme' }: { label?: string }) {
  const name = useId()
  const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, getServerPreference)

  return (
    <fieldset className="segmented">
      <legend className="sr-only">{label}</legend>
      {THEME_PREFERENCES.map(value => (
        <label key={value} className="segmented-option">
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => setThemePreference(value)}
          />
          <span>{LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  )
}
