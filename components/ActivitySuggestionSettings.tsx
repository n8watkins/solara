'use client'
import { useId } from 'react'
import type { ReactNode } from 'react'
import type { UserPreferences } from '@/lib/types'
import { ACTIVITY_CATEGORIES } from '@/lib/tiers'
import { hiddenPresetsFor, toggleInList } from '@/lib/activity-presets'

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
        <h4 className="text-[14px] font-bold text-ink">Activity suggestions</h4>
        <p className="text-[13px] leading-normal text-ink-3">
          Add and edit your activities from the dashboard. These settings control which preset
          suggestions the Add activity picker shows.
        </p>
      </div>

      <SettingsCard
        title="Hidden suggestions"
        summary={`${hiddenPresets.length} hidden`}
        action={
          hiddenPresets.length > 0 && (
            <button type="button" className="btn text-[12px]" onClick={() => setHidden([])}>
              Restore all
            </button>
          )
        }
      >
        {hiddenPresets.length === 0 ? (
          <p className="text-[13px] leading-[1.45] text-ink-3">
            Nothing hidden yet. To hide a preset, select its × in the Add activity picker.
          </p>
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
                  aria-label={`Restore ${activity.name}`}
                  className="btn px-[9px] py-[5px] text-[12px]"
                  onClick={() => setHidden(hiddenIds.filter(id => id !== activity.id))}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Preset categories"
        summary={`${collapsed.length} collapsed`}
        action={
          collapsed.length > 0 && (
            <button type="button" className="btn text-[12px]" onClick={() => setCollapsed([])}>
              Expand all
            </button>
          )
        }
      >
        <p className="sr-only" id={hintId}>
          Pressed categories start expanded in the Add activity picker.
        </p>
        <div
          role="group"
          aria-label="Preset categories"
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
                  <span aria-hidden="true">
                    {isCollapsed ? '▸' : '▾'} {category.emoji}
                  </span>{' '}
                  {category.name}
                </span>
                <span className="text-[11px] text-ink-3">
                  {category.activities.length}
                  <span className="sr-only"> presets</span>
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
