'use client'
import type { UserPreferences } from '@/lib/types'
import { ACTIVITY_CATEGORIES } from '@/lib/tiers'

interface Props {
  prefs: UserPreferences
  onChange: (prefs: UserPreferences) => void
}

export default function ActivitySuggestionSettings({ prefs, onChange }: Props) {
  const hiddenIds = prefs.hiddenActivitySuggestionIds ?? []
  const collapsed = prefs.collapsedActivityCategories ?? []
  const allPresets = ACTIVITY_CATEGORIES.flatMap(cat =>
    cat.activities.map(activity => ({ ...activity, category: cat.name })),
  )
  const hiddenPresets = allPresets.filter(activity => hiddenIds.includes(activity.id))

  function restoreSuggestion(id: string) {
    onChange({
      ...prefs,
      hiddenActivitySuggestionIds: hiddenIds.filter(hiddenId => hiddenId !== id),
    })
  }

  function restoreAllSuggestions() {
    onChange({ ...prefs, hiddenActivitySuggestionIds: [] })
  }

  function toggleCategory(name: string) {
    onChange({
      ...prefs,
      collapsedActivityCategories: collapsed.includes(name)
        ? collapsed.filter(category => category !== name)
        : [...collapsed, name],
    })
  }

  function expandAllCategories() {
    onChange({ ...prefs, collapsedActivityCategories: [] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
          Activity suggestions
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.5 }}>
          Add and edit active activities from the Dashboard. This panel only controls which preset
          suggestions appear there.
        </p>
      </div>

      <div
        className="metric-card"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <div>
            <p
              style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Hidden suggestions
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
              {hiddenPresets.length} hidden
            </p>
          </div>
          {hiddenPresets.length > 0 && (
            <button className="btn" onClick={restoreAllSuggestions} style={{ fontSize: '12px' }}>
              Restore all
            </button>
          )}
        </div>

        {hiddenPresets.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>
            Nothing hidden yet. Use the × on a preset suggestion in the Dashboard activity manager
            to hide it.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {hiddenPresets.map(activity => (
              <div
                key={activity.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '9px 10px',
                  borderRadius: '10px',
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border-md)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 650, color: 'var(--text)' }}>
                    {activity.icon} {activity.name}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-3)' }}>
                    {activity.category}
                  </p>
                </div>
                <button
                  className="btn"
                  onClick={() => restoreSuggestion(activity.id)}
                  style={{ fontSize: '12px', padding: '5px 9px' }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="metric-card"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <div>
            <p
              style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Preset categories
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
              {collapsed.length} collapsed
            </p>
          </div>
          {collapsed.length > 0 && (
            <button className="btn" onClick={expandAllCategories} style={{ fontSize: '12px' }}>
              Expand all
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {ACTIVITY_CATEGORIES.map(category => {
            const isCollapsed = collapsed.includes(category.name)
            return (
              <button
                key={category.name}
                onClick={() => toggleCategory(category.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '9px 10px',
                  borderRadius: '10px',
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border-md)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 650 }}>
                  {isCollapsed ? '▸' : '▾'} {category.emoji} {category.name}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                  {category.activities.length}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
