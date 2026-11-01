'use client'
import { Bell, Footprints, MapPin, Palette, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { alertsLaunched } from '@/lib/plans'
import { nextIndex } from '@/lib/roving-focus'
import m from '@/messages/settings'

export type SettingsTab =
  'general' | 'alerts' | 'appearance' | 'activities' | 'location' | 'account'

export interface SettingsSection {
  id: SettingsTab
  label: string
  /**
   * The label in the six-column bar on phones, when `label` is too long for it; the tab's
   * name stays `label`, which starts with it.
   */
  phoneLabel?: string
  Icon: LucideIcon
  desc: string
}

// Read when drawn, in the page's language. A phone label shorter than the label shows in
// the six-column bar on phones; the tab's name stays the label, which starts with it.
function section(
  id: SettingsTab,
  Icon: LucideIcon,
  label: () => string,
  desc: () => string,
  phoneLabel?: () => string,
): SettingsSection {
  return {
    id,
    Icon,
    get label() {
      return label()
    },
    get desc() {
      return desc()
    },
    get phoneLabel() {
      const phone = phoneLabel?.()
      return phone && phone !== label() ? phone : undefined
    },
  }
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // "Sun profile" filled its sixth of a 390 px bar, leaving the selected pill no side
  // padding (REVIEW6 L7). Alerts are their own tab (REVIEW5): under Sun profile they
  // showed with that tab selected and were hard to find. Every label fits six columns on
  // a 320 px phone.
  section(
    'general',
    Sun,
    () => m.tabSun,
    () => m.tabSunDesc,
    () => m.tabSunPhone,
  ),
  section(
    'alerts',
    Bell,
    () => m.tabAlerts,
    () => m.tabAlertsDesc,
    () => m.tabAlertsPhone,
  ),
  section(
    'appearance',
    Palette,
    () => m.tabDisplay,
    () => m.tabDisplayDesc,
    () => m.tabDisplayPhone,
  ),
  section(
    'activities',
    Footprints,
    () => m.tabActivities,
    () => m.tabActivitiesDesc,
    () => m.tabActivitiesPhone,
  ),
  section(
    'location',
    MapPin,
    () => m.tabLocation,
    () => m.tabLocationDesc,
    () => m.tabLocationPhone,
  ),
  section(
    'account',
    UserRound,
    () => m.tabAccount,
    () => m.tabAccountDesc,
    () => m.tabAccountPhone,
  ),
]

/** The Alerts tab's line until alerts are switched on: no reminders to promise yet (REVIEW9 QA L1). */

export function settingsSection(tab: SettingsTab): SettingsSection {
  const section = SETTINGS_SECTIONS.find(s => s.id === tab) ?? SETTINGS_SECTIONS[0]!
  return section.id === 'alerts' && !alertsLaunched()
    ? { ...section, desc: m.tabAlertsComingDesc }
    : section
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
      aria-label={m.sections}
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
          aria-label={s.phoneLabel ? s.label : undefined}
          tabIndex={tab === s.id ? 0 : -1}
          onClick={() => onTabChange(s.id)}
          onKeyDown={handleKeyDown}
          className="flex min-h-9 items-center gap-[9px] rounded-[9px] px-3 py-[9px] text-left text-[13px] font-semibold text-ink-2 transition-colors duration-120 hover:bg-surface-metric aria-selected:bg-surface-metric aria-selected:text-accent max-sm:min-h-13 max-sm:flex-col max-sm:justify-center max-sm:gap-1 max-sm:px-0 max-sm:py-[7px] max-sm:text-center max-sm:text-[length:clamp(9.5px,2.75vw,11px)] max-sm:leading-[1.15]"
        >
          <s.Icon size={17} className="shrink-0 max-sm:size-[19px]" />
          {s.phoneLabel ? (
            <>
              <span className="max-sm:hidden">{s.label}</span>
              <span className="sm:hidden">{s.phoneLabel}</span>
            </>
          ) : (
            s.label
          )}
        </button>
      ))}
    </div>
  )
}
