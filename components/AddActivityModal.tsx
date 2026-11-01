'use client'
import type { Activity, TierLevel } from '@/lib/types'
import ActivityManager from './ActivityManager'
import ActivityModalShell from './ActivityModalShell'
import m from '@/messages/editor'

interface Props {
  activities: Activity[]
  tier: TierLevel
  hiddenSuggestionIds?: string[]
  collapsedCategories?: string[]
  onActivitiesChange: (activities: Activity[]) => void
  onHideSuggestion: (id: string) => void
  onToggleCategory: (name: string) => void
  onClose: () => void
}

export default function AddActivityModal({
  activities,
  tier,
  hiddenSuggestionIds,
  collapsedCategories,
  onActivitiesChange,
  onHideSuggestion,
  onToggleCategory,
  onClose,
}: Props) {
  return (
    <ActivityModalShell
      title={m.addActivity}
      description={m.addLead}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            className="btn btn-primary min-w-[120px] justify-center"
            onClick={onClose}
          >
            {m.done}
          </button>
        </div>
      }
    >
      <ActivityManager
        selected={activities}
        tier={tier}
        hiddenSuggestionIds={hiddenSuggestionIds}
        collapsedCategories={collapsedCategories}
        onChange={onActivitiesChange}
        onHideSuggestion={onHideSuggestion}
        onToggleCategory={onToggleCategory}
      />
    </ActivityModalShell>
  )
}
