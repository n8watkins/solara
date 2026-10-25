'use client'
import clsx from 'clsx'
import { useState } from 'react'
import { formatActivityDuration, presetCategoriesFor, type Preset } from '@/lib/activity-presets'

interface Props {
  isSelected: (id: string) => boolean
  /** At the plan's activity limit: unselected presets are locked. */
  atLimit: boolean
  hiddenSuggestionIds: readonly string[]
  collapsedCategories: readonly string[]
  onToggle: (preset: Preset) => void
  onHideSuggestion?: (id: string) => void
  onToggleCategory?: (name: string) => void
}

/** Search box and preset suggestions by category, each a toggle button. */
export default function ActivityPresetBrowser({
  isSelected,
  atLimit,
  hiddenSuggestionIds,
  collapsedCategories,
  onToggle,
  onHideSuggestion,
  onToggleCategory,
}: Props) {
  const [search, setSearch] = useState('')
  const searching = search.trim() !== ''
  const categories = presetCategoriesFor(search, hiddenSuggestionIds)

  return (
    <>
      <input
        type="search"
        aria-label="Search activities"
        placeholder="Search activities..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 text-[13px]"
      />

      <div className="flex flex-col gap-3">
        {categories.length === 0 && (
          <div className="rounded-[10px] bg-surface-metric px-3.5 py-3 text-[13px] text-ink-3">
            No suggestions match. Restore hidden suggestions in Settings, under Activities.
          </div>
        )}
        {categories.map(cat => {
          const collapsed = !searching && collapsedCategories.includes(cat.name)
          return (
            <div key={cat.name}>
              <div
                className={clsx('flex items-center justify-between gap-2', !collapsed && 'mb-1.5')}
              >
                <button
                  type="button"
                  aria-expanded={searching ? undefined : !collapsed}
                  disabled={searching}
                  onClick={() => onToggleCategory?.(cat.name)}
                  className="min-h-6 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase disabled:cursor-default"
                >
                  <span aria-hidden="true">
                    {!searching && (collapsed ? '▸' : '▾')} {cat.emoji}
                  </span>{' '}
                  {cat.name}
                </button>
                {!searching && (
                  <span
                    aria-label={`${cat.activities.length} activities`}
                    className="text-[11px] text-ink-3"
                  >
                    {cat.activities.length}
                  </span>
                )}
              </div>
              {!collapsed && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5">
                  {cat.activities.map(preset => (
                    <PresetTile
                      key={preset.id}
                      preset={preset}
                      selected={isSelected(preset.id)}
                      locked={!isSelected(preset.id) && atLimit}
                      onToggle={() => onToggle(preset)}
                      onHide={onHideSuggestion && (() => onHideSuggestion(preset.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/**
 * One preset: the tile toggles it (a + to add, a check once added), and a separate,
 * plainly labeled Hide removes the suggestion from the picker.
 */
function PresetTile({
  preset,
  selected,
  locked,
  onToggle,
  onHide,
}: {
  preset: Preset
  selected: boolean
  locked: boolean
  onToggle: () => void
  onHide?: () => void
}) {
  return (
    <div
      className={clsx(
        'flex min-h-12 items-stretch rounded-[9px] transition-all duration-[120ms]',
        selected
          ? 'border-[1.5px] border-accent bg-accent-soft'
          : 'border-[0.5px] border-line-strong bg-surface-card',
        locked && 'opacity-40',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        disabled={locked}
        className="flex min-w-0 flex-1 items-center gap-[7px] rounded-[8px] py-2 pr-2 pl-2.5 text-left disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className="shrink-0 text-[16px]">
          {preset.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              'line-clamp-2 text-[12px] leading-[1.3]',
              selected ? 'font-medium text-accent' : 'font-normal text-ink',
            )}
          >
            {preset.name}
          </p>
          <p className="text-[10px] text-ink-3">{formatActivityDuration(preset.durationMins)}</p>
        </div>
        {locked ? (
          <span className="shrink-0 text-[11px]">
            <span aria-hidden="true">🔒</span>
            <span className="sr-only">Locked</span>
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={clsx(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-[14px] leading-none font-semibold',
              selected ? 'bg-accent text-accent-on' : 'bg-surface-metric text-accent',
            )}
          >
            {selected ? '✓' : '+'}
          </span>
        )}
      </button>
      {!selected && onHide && (
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${preset.name} suggestion`}
          title="Hide this suggestion"
          className="shrink-0 rounded-r-[8px] border-l-[0.5px] border-line-strong px-2.5 text-[11px] font-medium text-ink-3"
        >
          Hide
        </button>
      )}
    </div>
  )
}
