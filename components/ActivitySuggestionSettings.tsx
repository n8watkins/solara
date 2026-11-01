'use client'
import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode } from 'react'
import type { UserPreferences } from '@/lib/types'
import { ACTIVITY_CATEGORIES } from '@solara/core/tiers'
import { hiddenPresetsFor, toggleInList } from '@/lib/activity-presets'
import m from '@/messages/settings'

interface Props {
  prefs: UserPreferences
  onChange: (prefs: UserPreferences) => void
}

const ROW =
  'flex items-center justify-between gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-card px-2.5 py-[9px]'

export default function ActivitySuggestionSettings({ prefs, onChange }: Props) {
  const hintId = useId()
  const hiddenIds = prefs.hiddenActivitySuggestionIds ?? []
  const collapsed = prefs.collapsedActivityCategories ?? []
  const hiddenPresets = hiddenPresetsFor(hiddenIds)

  const setHidden = (ids: string[]) => onChange({ ...prefs, hiddenActivitySuggestionIds: ids })
  const setCollapsed = (names: string[]) =>
    onChange({ ...prefs, collapsedActivityCategories: names })

  return (
    <div className="flex flex-col gap-3.5">
      <div className="metric-card flex flex-col gap-2">
        <h4 className="text-[14px] font-bold text-ink">{m.activitySuggestions}</h4>
        <p className="text-[13px] leading-normal text-ink-3">{m.activitySuggestionsHint}</p>
      </div>

      <SettingsCard
        title={m.hiddenSuggestions}
        summary={m.hiddenCount(hiddenPresets.length)}
        action={
          hiddenPresets.length > 0 && (
            <button type="button" className="btn text-[12px]" onClick={() => setHidden([])}>
              {m.restoreAll}
            </button>
          )
        }
      >
        {hiddenPresets.length === 0 ? (
          <p className="text-[13px] leading-[1.45] text-ink-3">{m.nothingHidden}</p>
        ) : (
          <div className="flex flex-col gap-[7px]">
            {hiddenPresets.map(activity => (
              <div key={activity.id} className={ROW}>
                <div className="min-w-0">
                  <p className="text-[13px] font-[650] text-ink">
                    <span aria-hidden="true">{activity.icon}</span> {activity.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{activity.category}</p>
                </div>
                <button
                  type="button"
                  aria-label={m.restoreNamed(activity.name)}
                  className="btn px-[9px] py-[5px] text-[12px]"
                  onClick={() => setHidden(hiddenIds.filter(id => id !== activity.id))}
                >
                  {m.restore}
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={m.presetCategories}
        summary={m.collapsedCount(collapsed.length)}
        action={
          collapsed.length > 0 && (
            <button type="button" className="btn text-[12px]" onClick={() => setCollapsed([])}>
              {m.expandAll}
            </button>
          )
        }
      >
        <p className="sr-only" id={hintId}>
          {m.pressedCategories}
        </p>
        <div
          role="group"
          aria-label={m.presetCategories}
          aria-describedby={hintId}
          className="flex flex-col gap-[7px]"
        >
          {ACTIVITY_CATEGORIES.map(category => {
            const isCollapsed = collapsed.includes(category.name)
            return (
              <button
                key={category.name}
                type="button"
                aria-pressed={!isCollapsed}
                onClick={() => setCollapsed(toggleInList(collapsed, category.name))}
                className={`${ROW} text-left text-ink`}
              >
                <span className="text-[13px] font-[650]">
                  <span aria-hidden="true" className="inline-flex items-center gap-1 align-middle">
                    <ChevronDown
                      size={14}
                      className={`text-ink-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                    {category.emoji}
                  </span>{' '}
                  {category.label}
                </span>
                <span className="text-[11px] text-ink-3">
                  {category.activities.length}
                  <span className="sr-only">{m.presetsSuffix}</span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>
    </div>
  )
}

function SettingsCard({
  title,
  summary,
  action,
  children,
}: {
  title: string
  summary: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div className="metric-card flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="mb-[3px] text-[13px] font-bold text-ink">{title}</h4>
          <p className="text-[12px] text-ink-3">{summary}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}
