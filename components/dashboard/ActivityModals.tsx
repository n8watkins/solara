import type { Activity, TierLevel, UserPreferences } from '@/lib/types'
import { AddActivityModal, EditActivityModal, ManageActivitiesModal } from '../deferred'

/**
 * The dashboard's activity dialogs, which save through `onPrefsUpdate`. Editing
 * opens over Manage, so closing the editor returns to the list.
 */
export default function ActivityModals({
  modal,
  onModalChange,
  editingId,
  onEdit,
  prefs,
  tier,
  onPrefsUpdate,
}: {
  modal: 'add' | 'manage' | null
  onModalChange: (modal: 'add' | 'manage' | null) => void
  /** The activity being edited, by id. */
  editingId: string | null
  onEdit: (activity: Activity | null) => void
  prefs: UserPreferences
  tier: TierLevel
  onPrefsUpdate: (prefs: UserPreferences) => void
}) {
  const close = () => onModalChange(null)
  const editing = editingId ? prefs.activities.find(a => a.id === editingId) : undefined

  function updateActivities(activities: UserPreferences['activities']) {
    onPrefsUpdate({ ...prefs, activities })
  }

  function hideSuggestion(id: string) {
    const hidden = prefs.hiddenActivitySuggestionIds ?? []
    if (hidden.includes(id)) return
    onPrefsUpdate({ ...prefs, hiddenActivitySuggestionIds: [...hidden, id] })
  }

  function toggleCategory(name: string) {
    const collapsed = prefs.collapsedActivityCategories ?? []
    onPrefsUpdate({
      ...prefs,
      collapsedActivityCategories: collapsed.includes(name)
        ? collapsed.filter(c => c !== name)
        : [...collapsed, name],
    })
  }

  return (
    <>
      {modal === 'add' && (
        <AddActivityModal
          activities={prefs.activities}
          tier={tier}
          hiddenSuggestionIds={prefs.hiddenActivitySuggestionIds}
          collapsedCategories={prefs.collapsedActivityCategories}
          onActivitiesChange={updateActivities}
          onHideSuggestion={hideSuggestion}
          onToggleCategory={toggleCategory}
          onClose={close}
        />
      )}
      {modal === 'manage' && (
        <ManageActivitiesModal
          activities={prefs.activities}
          tier={tier}
          onActivitiesChange={updateActivities}
          onAddActivity={() => onModalChange('add')}
          onEditActivity={onEdit}
          onClose={close}
        />
      )}
      {editing && (
        <EditActivityModal
          activity={editing}
          onSave={updated => {
            updateActivities(prefs.activities.map(a => (a.id === updated.id ? updated : a)))
            onEdit(null)
          }}
          onDelete={id => {
            updateActivities(prefs.activities.filter(a => a.id !== id))
            onEdit(null)
          }}
          onClose={() => onEdit(null)}
        />
      )}
    </>
  )
}
