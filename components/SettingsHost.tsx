'use client'
import { useCallback, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { OpenSettingsContext } from '@/lib/open-settings'
import type { UserPreferences } from '@/lib/types'
import { PreferencesModal } from './deferred'
import type { SettingsTab } from './settings/SettingsTabs'

/**
 * Settings for everything below: provides the opener (lib/open-settings.ts) and shows the
 * Settings sheet, which loads on demand, while it is open. Saving applies the changes
 * and closes it.
 */
export default function SettingsHost({
  prefs,
  user,
  onSave,
  initialTab = null,
  children,
}: {
  prefs: UserPreferences
  user: User | null
  onSave: (updated: UserPreferences) => void
  /** Opens Settings on this tab at once (the UI harness's Settings screens). */
  initialTab?: SettingsTab | null
  children: ReactNode
}) {
  const [tab, setTab] = useState<SettingsTab | null>(initialTab)
  const open = useCallback((next: SettingsTab = 'general') => setTab(next), [])
  return (
    <OpenSettingsContext value={open}>
      {children}
      {tab && (
        <PreferencesModal
          prefs={prefs}
          user={user}
          initialTab={tab}
          onSave={updated => {
            onSave(updated)
            setTab(null)
          }}
          onClose={() => setTab(null)}
        />
      )}
    </OpenSettingsContext>
  )
}
