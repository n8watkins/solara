'use client'
import { Bell, Footprints, MapPin, Palette, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { nextIndex } from '@/lib/roving-focus'

export type SettingsTab =
  'general' | 'alerts' | 'appearance' | 'activities' | 'location' | 'account'

export interface SettingsSection {
  id: SettingsTab
  label: string
  Icon: LucideIcon
  desc: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general',
    label: 'Sun profile',
    Icon: Sun,
    desc: 'Skin type and the assumptions behind your exposure estimates.',
  },
  {
    // Its own tab (REVIEW5): under Sun profile, the alerts showed with that tab selected
    // and were hard to find.
    id: 'alerts',
    label: 'Alerts',
    Icon: Bell,
    desc: 'Morning, UV and event alerts on your devices.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: Palette,
    desc: 'Theme, units and what the dashboard shows.',
  },
  {
    id: 'activities',
    label: 'Activities',
    Icon: Footprints,
    desc: 'Suggestion and category preferences.',
  },
  {
    id: 'location',
    label: 'Location',
    Icon: MapPin,
    desc: 'Where Solara checks the UV forecast.',
  },
  {
    id: 'account',
    label: 'Account',
    Icon: UserRound,
    desc: 'Plan, sign-in, and cross-device sync.',
  },
]

export function settingsSection(tab: SettingsTab): SettingsSection {
  return SETTINGS_SECTIONS.find(s => s.id === tab) ?? SETTINGS_SECTIONS[0]!
}

interface Props {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  tabId: (tab: SettingsTab) => string
  panelId: string
}

/**
 * The section switcher: a left rail on desktop, a six-column bar on phones
 * that keeps every section on screen down to 320 px wide. Follows the tabs
 * pattern: arrows move between sections (both axes, since the rail turns
 * horizontal on phones), Home and End jump to the ends.
 */
export default function SettingsTabs({ tab, onTabChange, tabId, panelId }: Props) {
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({})

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextIndex(
      event.key,
      SETTINGS_SECTIONS.findIndex(s => s.id === tab),
      SETTINGS_SECTIONS.length,
    )
    if (next === null) return
    event.preventDefault()
    const nextTab = SETTINGS_SECTIONS[next]!.id
    onTabChange(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex w-47 shrink-0 flex-col gap-0.5 overflow-y-auto border-r-[0.5px] border-line-strong px-2.5 py-3.5 max-sm:grid max-sm:w-auto max-sm:grid-cols-6 max-sm:gap-0.5 max-sm:overflow-visible max-sm:border-r-0 max-sm:border-b-[0.5px] max-sm:px-3 max-sm:py-2"
    >
      {SETTINGS_SECTIONS.map(s => (
        <button
          key={s.id}
          ref={el => {
            tabRefs.current[s.id] = el
          }}
          type="button"
          role="tab"
          id={tabId(s.id)}
          aria-selected={tab === s.id}
          aria-controls={panelId}
          tabIndex={tab === s.id ? 0 : -1}
          onClick={() => onTabChange(s.id)}
          onKeyDown={handleKeyDown}
          className="flex min-h-9 items-center gap-[9px] rounded-[9px] px-3 py-[9px] text-left text-[13px] font-semibold text-ink-2 transition-colors duration-120 hover:bg-surface-metric aria-selected:bg-surface-metric aria-selected:text-accent max-sm:min-h-13 max-sm:flex-col max-sm:justify-center max-sm:gap-1 max-sm:px-0 max-sm:py-[7px] max-sm:text-center max-sm:text-[length:clamp(9.5px,2.75vw,11px)] max-sm:whitespace-nowrap"
        >
          <s.Icon size={17} className="shrink-0 max-sm:size-[19px]" />
          {s.label}
        </button>
      ))}
    </div>
  )
}
