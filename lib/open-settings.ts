import { createContext, useContext } from 'react'
import type { SettingsTab } from '@/components/settings/SettingsTabs'

/**
 * Opens Settings on a tab (Sun profile by default), for guests and accounts alike:
 * the header's account menu or a guest's Settings button, and the burn card's "Edit"
 * beside the skin type. components/SettingsHost.tsx provides it; null outside one.
 */
export const OpenSettingsContext = createContext<((tab?: SettingsTab) => void) | null>(null)

/** Opens Settings, or null where no SettingsHost is above. */
export function useOpenSettings(): ((tab?: SettingsTab) => void) | null {
  return useContext(OpenSettingsContext)
}
