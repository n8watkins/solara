'use client'
import { X } from 'lucide-react'
import { useId, useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserPreferences } from '@/lib/types'
import {
  applySettingsDraft,
  isSettingsDraftDirty,
  settingsDraftFrom,
  type SettingsDraft,
} from '@/lib/settings'
import ActivitySuggestionSettings from './ActivitySuggestionSettings'
import Dialog from './Dialog'
import AccountSettings from './settings/AccountSettings'
import AppearanceSettings from './settings/AppearanceSettings'
import LocationSettings from './settings/LocationSettings'
import NotificationSettings from './settings/NotificationSettings'
import SettingsTabs, { settingsSection, type SettingsTab } from './settings/SettingsTabs'
import SunProfileSettings from './settings/SunProfileSettings'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
  initialTab?: SettingsTab
  user?: User | null
}

/**
 * Settings: a sectioned sheet that edits a draft of the preferences. Nothing
 * is saved until "Save settings"; closing with unsaved changes asks first.
 */
export default function PreferencesModal({ prefs, onSave, onClose, initialTab, user }: Props) {
  const id = useId()
  const [tab, setTab] = useState<SettingsTab>(initialTab || 'general')
  const [draft, setDraft] = useState(() => settingsDraftFrom(prefs))
  const [joinedWaitlist, setJoinedWaitlist] = useState(false)
  const tier = prefs.tier || 'anonymous'
  const updated = applySettingsDraft(prefs, draft)
  const dirty = isSettingsDraftDirty(prefs, draft)
  const section = settingsSection(tab)
  const titleId = `${id}-title`
  const tabId = (t: SettingsTab) => `${id}-tab-${t}`
  const panelId = `${id}-panel`

  function update(patch: Partial<SettingsDraft>) {
    setDraft(current => ({ ...current, ...patch }))
  }

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved settings changes?')) return
    onClose()
  }

  function joinWaitlist(email: string) {
    onSave({
      ...updated,
      upgradeInterest: { email: email || undefined, createdAt: new Date().toISOString() },
    })
    setJoinedWaitlist(true)
  }

  return (
    <Dialog onClose={requestClose} labelledBy={titleId} variant="sheet">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b-[0.5px] border-line-strong px-5.5 pt-4.5 pb-3.5 max-sm:px-4 max-sm:pt-[max(14px,env(safe-area-inset-top))]">
          <h2 id={titleId} className="text-[18px] font-bold text-ink">
            Settings
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-metric text-[18px] text-ink-2"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <SettingsTabs tab={tab} onTabChange={setTab} tabId={tabId} panelId={panelId} />

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(tab)}
            tabIndex={0}
            className="min-w-0 flex-1 overflow-y-auto p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent max-sm:p-4"
          >
            <div className="mb-4.5">
              <h3 className="text-[16px] font-bold text-ink">
                <section.Icon size={17} className="mr-1.5 inline-block align-[-3px] text-accent" />
                {section.label}
              </h3>
              <p className="mt-1 text-[13px] text-ink-3">{section.desc}</p>
            </div>

            {tab === 'general' && <SunProfileSettings draft={draft} onChange={update} />}
            {tab === 'alerts' && (
              <NotificationSettings tier={tier} user={user} draft={draft} onChange={update} />
            )}
            {tab === 'appearance' && <AppearanceSettings draft={draft} onChange={update} />}
            {tab === 'activities' && (
              <ActivitySuggestionSettings
                prefs={updated}
                onChange={next =>
                  update({
                    hiddenActivitySuggestionIds: next.hiddenActivitySuggestionIds ?? [],
                    collapsedActivityCategories: next.collapsedActivityCategories ?? [],
                  })
                }
              />
            )}
            {tab === 'location' && (
              <LocationSettings
                location={draft.location}
                onChange={location => update({ location })}
              />
            )}
            {tab === 'account' && (
              <AccountSettings
                tier={tier}
                user={user}
                prefs={updated}
                waitlisted={joinedWaitlist || !!prefs.upgradeInterest}
                onJoinWaitlist={joinWaitlist}
                onSignedOut={onClose}
              />
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2.5 border-t-[0.5px] border-line-strong px-5.5 py-[15px] max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" className="btn flex-1 justify-center" onClick={requestClose}>
            {dirty ? 'Discard' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1 justify-center"
            onClick={() => onSave(updated)}
          >
            Save settings
          </button>
        </div>
      </div>
    </Dialog>
  )
}
