'use client'
import type { Activity, TierLevel } from '@/lib/types'
import ActivityManager from './ActivityManager'
import ActivityModalShell from './ActivityModalShell'

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
      title="Add activity"
      description="Choose a preset or create a custom outdoor activity. You can fine-tune duration and SPF after adding."
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ minWidth: '120px', justifyContent: 'center' }}
          >
            Done
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
