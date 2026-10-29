'use client'
import clsx from 'clsx'
import { useState } from 'react'
import type { Activity, TierLevel } from '@/lib/types'
import { activityLimitNote, canAddActivity } from '@solara/core/tiers'
import { isStoreBuild } from '@/lib/store-build'
import { activityFromPreset, removeActivity, type Preset } from '@/lib/activity-presets'
import { useTransient } from '@/lib/use-transient'
import ActivityCustomForm from './ActivityCustomForm'
import ActivityPresetBrowser from './ActivityPresetBrowser'
import ActivitySelectedList from './ActivitySelectedList'

interface Props {
  selected: Activity[]
  tier: TierLevel
  hiddenSuggestionIds?: string[]
  collapsedCategories?: string[]
  onChange: (activities: Activity[]) => void
  onHideSuggestion?: (id: string) => void
  onToggleCategory?: (name: string) => void
}

type Mode = 'browse' | 'manage'

/** How long the "<name> added" confirmation stays up, in milliseconds. */
const ADDED_MS = 1800

/** The body of the Add activity dialog: browse presets or adjust "My activities". */
export default function ActivityManager({
  selected,
  tier,
  hiddenSuggestionIds = [],
  collapsedCategories = [],
  onChange,
  onHideSuggestion,
  onToggleCategory,
}: Props) {
  const [mode, setMode] = useState<Mode>('browse')
  const [addedName, showAdded] = useTransient<string>(ADDED_MS)
  const atLimit = !canAddActivity(tier, selected.length)
  const isSelected = (id: string) => selected.some(a => a.id === id)

  function togglePreset(preset: Preset) {
    if (isSelected(preset.id)) {
      onChange(removeActivity(selected, preset.id))
    } else if (!atLimit) {
      onChange([...selected, activityFromPreset(preset)])
      showAdded(preset.name)
    }
  }

  function addCustom(activity: Activity) {
    onChange([...selected, activity])
    showAdded(activity.name)
    setMode('manage')
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div
        role="group"
        aria-label="View"
        className="flex gap-1 rounded-[10px] bg-surface-metric p-[3px]"
      >
        {(['browse', 'manage'] as const).map(m => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={clsx(
              'flex-1 rounded-lg px-2.5 py-[7px] text-[13px] font-semibold transition-all duration-[120ms]',
              mode === m
                ? 'border-[0.5px] border-line-strong bg-surface-card text-ink'
                : 'text-ink-3',
            )}
          >
            {m === 'browse'
              ? 'Browse'
              : `My activities${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        ))}
      </div>

      {mode === 'browse' && (
        <>
          {atLimit && activityLimitNote(tier, { offerPro: !isStoreBuild() }) && (
            <div className="rounded-[10px] border-[0.5px] border-notice-border bg-notice px-3.5 py-2.5 text-[13px] text-ink-2">
              {activityLimitNote(tier, { offerPro: !isStoreBuild() })}
            </div>
          )}

          {/* Mounted for as long as presets can be added, so screen readers
              announce each addition. display: contents adds no layout box. */}
          <div role="status" className="contents">
            {addedName && (
              <div className="rounded-[9px] border-[0.5px] border-success/30 bg-success/10 px-3 py-2 text-[13px] text-success">
                ✓ {addedName} added
              </div>
            )}
          </div>

          <ActivityCustomForm disabled={atLimit} onAdd={addCustom} />

          <ActivityPresetBrowser
            isSelected={isSelected}
            atLimit={atLimit}
            hiddenSuggestionIds={hiddenSuggestionIds}
            collapsedCategories={collapsedCategories}
            onToggle={togglePreset}
            onHideSuggestion={onHideSuggestion}
            onToggleCategory={onToggleCategory}
          />
        </>
      )}

      {mode === 'manage' && (
        <ActivitySelectedList
          activities={selected}
          onChange={onChange}
          onBrowse={() => setMode('browse')}
        />
      )}
    </div>
  )
}
