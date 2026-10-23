'use client'
import { useId, useState } from 'react'
import type { Activity } from '@/lib/types'
import { ACTIVITY_CATEGORIES, canAddActivity, TIER_LIMITS } from '@/lib/tiers'
import type { TierLevel } from '@/lib/types'
import EmojiPicker from './EmojiPicker'

interface Props {
  selected: Activity[]
  tier: TierLevel
  hiddenSuggestionIds?: string[]
  collapsedCategories?: string[]
  onChange: (activities: Activity[]) => void
  onHideSuggestion?: (id: string) => void
  onToggleCategory?: (name: string) => void
}

export default function ActivityManager({
  selected,
  tier,
  hiddenSuggestionIds = [],
  collapsedCategories = [],
  onChange,
  onHideSuggestion,
  onToggleCategory,
}: Props) {
  const [mode, setMode] = useState<'browse' | 'manage'>('browse')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customMins, setCustomMins] = useState(30)
  const [customIcon, setCustomIcon] = useState('🏃')
  const [customSunscreen, setCustomSunscreen] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [addedName, setAddedName] = useState<string | null>(null)
  const id = useId()
  const emojiId = `${id}-emoji`
  const customDurationId = `${id}-custom-duration`
  const spfLabelId = `${id}-spf`

  const hiddenSet = new Set(hiddenSuggestionIds)
  const collapsedSet = new Set(collapsedCategories)
  const atLimit = !canAddActivity(tier, selected.length)

  function isSelected(id: string) {
    return selected.some(a => a.id === id)
  }

  function flash(name: string) {
    setAddedName(name)
    setTimeout(() => setAddedName(null), 1800)
  }

  function toggle(preset: {
    id: string
    name: string
    icon: string
    durationMins: number
    maxUV: number
  }) {
    if (isSelected(preset.id)) {
      onChange(selected.filter(a => a.id !== preset.id))
    } else {
      if (atLimit) return
      onChange([...selected, { ...preset, sunscreen: false }])
      flash(preset.name)
    }
  }

  function addCustom() {
    if (!customName.trim() || atLimit) return
    const name = customName.trim()
    onChange([
      ...selected,
      {
        id: `custom_${Date.now()}`,
        name,
        icon: customIcon,
        durationMins: customMins,
        maxUV: 4,
        sunscreen: customSunscreen,
        custom: true,
      },
    ])
    setCustomName('')
    setCustomMins(30)
    setCustomSunscreen(false)
    setShowCreate(false)
    flash(name)
    setMode('manage')
  }

  function updateDuration(id: string, mins: number) {
    onChange(selected.map(a => (a.id === id ? { ...a, durationMins: Math.max(5, mins) } : a)))
  }

  function updateSunscreen(id: string, sunscreen: boolean) {
    onChange(selected.map(a => (a.id === id ? { ...a, sunscreen } : a)))
  }

  function remove(id: string) {
    onChange(selected.filter(a => a.id !== id))
  }

  const filteredCats = search
    ? [
        {
          name: 'Results',
          emoji: '🔍',
          activities: ACTIVITY_CATEGORIES.flatMap(c => c.activities).filter(
            a => !hiddenSet.has(a.id) && a.name.toLowerCase().includes(search.toLowerCase()),
          ),
        },
      ]
    : ACTIVITY_CATEGORIES.map(cat => ({
        ...cat,
        activities: cat.activities.filter(a => !hiddenSet.has(a.id)),
      })).filter(cat => cat.activities.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Mode switch */}
      <div
        role="group"
        aria-label="View"
        style={{
          display: 'flex',
          gap: '4px',
          padding: '3px',
          borderRadius: '10px',
          background: 'var(--bg-metric)',
        }}
      >
        {(['browse', 'manage'] as const).map(m => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              background: mode === m ? 'var(--bg-card)' : 'transparent',
              color: mode === m ? 'var(--text)' : 'var(--text-3)',
              border: mode === m ? '0.5px solid var(--border-md)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {m === 'browse'
              ? 'Browse'
              : `My activities${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        ))}
      </div>

      {mode === 'browse' && (
        <>
          {atLimit && tier !== 'paid' && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'var(--notice-bg)',
                border: '0.5px solid var(--notice-border)',
                fontSize: '13px',
                color: 'var(--text-2)',
              }}
            >
              {tier === 'anonymous'
                ? '👤 Create an account to add activities.'
                : `🆓 Free plan: ${TIER_LIMITS.free.activities} activities. Upgrade to Pro for unlimited.`}
            </div>
          )}

          {/* Mounted for as long as presets can be added, so screen readers
              announce each addition. display: contents adds no layout box. */}
          <div role="status" style={{ display: 'contents' }}>
            {addedName && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '9px',
                  background: 'rgba(22,163,74,0.1)',
                  border: '0.5px solid rgba(22,163,74,0.3)',
                  fontSize: '13px',
                  color: 'var(--success)',
                }}
              >
                ✓ {addedName} added
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-expanded={showCreate}
              onClick={() => setShowCreate(s => !s)}
              className="btn btn-primary"
              style={{
                width: '100%',
                justifyContent: 'center',
                fontSize: '14px',
                padding: '10px',
                borderRadius: '12px',
              }}
              disabled={atLimit}
            >
              {showCreate ? '✕ Cancel' : '+ Create custom activity'}
            </button>

            {showCreate && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'var(--bg-metric)',
                  border: '0.5px solid var(--border-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      aria-label="Choose icon"
                      aria-expanded={showEmoji}
                      aria-haspopup="dialog"
                      aria-controls={showEmoji ? emojiId : undefined}
                      onClick={() => setShowEmoji(s => !s)}
                      style={{
                        width: '44px',
                        height: '44px',
                        fontSize: '22px',
                        borderRadius: '10px',
                        border: '0.5px solid var(--border-md)',
                        background: 'var(--bg-card)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {customIcon}
                    </button>
                    {showEmoji && (
                      <EmojiPicker
                        id={emojiId}
                        value={customIcon}
                        onChange={setCustomIcon}
                        onClose={() => setShowEmoji(false)}
                      />
                    )}
                  </div>
                  <input
                    aria-label="Activity name"
                    placeholder="Activity name"
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustom()}
                    style={{ flex: 1, fontSize: '14px' }}
                  />
                </div>
                <div
                  style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <label
                    htmlFor={customDurationId}
                    style={{ fontSize: '13px', color: 'var(--text-2)', flexShrink: 0 }}
                  >
                    Duration
                  </label>
                  <input
                    id={customDurationId}
                    type="number"
                    min="5"
                    step="5"
                    value={customMins}
                    onChange={e => setCustomMins(Math.max(5, parseInt(e.target.value) || 5))}
                    style={{ width: '80px', fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>min</span>
                </div>
                <span id={spfLabelId} className="sr-only">
                  Sun protection
                </span>
                <div
                  role="group"
                  aria-labelledby={spfLabelId}
                  style={{ display: 'flex', gap: '8px' }}
                >
                  {[
                    { val: false, label: 'No SPF' },
                    { val: true, label: 'SPF 30+' },
                  ].map(o => (
                    <button
                      key={String(o.val)}
                      type="button"
                      aria-pressed={customSunscreen === o.val}
                      onClick={() => setCustomSunscreen(o.val)}
                      style={{
                        flex: 1,
                        padding: '9px 10px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        border:
                          customSunscreen === o.val
                            ? '1.5px solid var(--accent)'
                            : '0.5px solid var(--border-md)',
                        background:
                          customSunscreen === o.val ? 'var(--accent-soft)' : 'var(--bg-card)',
                        color: 'var(--text)',
                        fontSize: '13px',
                        fontWeight: 650,
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={addCustom}
                  disabled={!customName.trim()}
                  style={{ justifyContent: 'center' }}
                >
                  Add activity
                </button>
              </div>
            )}
          </div>

          <input
            type="search"
            aria-label="Search activities"
            placeholder="Search activities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: '13px',
              padding: '8px 12px',
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredCats.length === 0 && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-metric)',
                  fontSize: '13px',
                  color: 'var(--text-3)',
                }}
              >
                No suggestions match. Restore hidden suggestions in Settings, under Activities.
              </div>
            )}
            {filteredCats.map(cat => {
              const collapsed = !search && collapsedSet.has(cat.name)
              return (
                <div key={cat.name}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: collapsed ? 0 : '6px',
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={search ? undefined : !collapsed}
                      disabled={!!search}
                      onClick={() => !search && onToggleCategory?.(cat.name)}
                      style={{
                        margin: 0,
                        padding: 0,
                        minHeight: '24px',
                        background: 'none',
                        border: 'none',
                        cursor: search ? 'default' : 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-3)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      <span aria-hidden="true">
                        {!search && (collapsed ? '▸' : '▾')} {cat.emoji}
                      </span>{' '}
                      {cat.name}
                    </button>
                    {!search && (
                      <span
                        aria-label={`${cat.activities.length} activities`}
                        style={{ fontSize: '11px', color: 'var(--text-3)' }}
                      >
                        {cat.activities.length}
                      </span>
                    )}
                  </div>
                  {!collapsed && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: '6px',
                      }}
                    >
                      {cat.activities.map(p => {
                        const sel = isSelected(p.id)
                        const locked = !sel && atLimit
                        return (
                          <div key={p.id} style={{ position: 'relative' }}>
                            <button
                              type="button"
                              aria-pressed={sel}
                              onClick={() => toggle(p)}
                              disabled={locked}
                              style={{
                                width: '100%',
                                minHeight: '48px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '7px',
                                padding: '8px 32px 8px 10px',
                                borderRadius: '9px',
                                textAlign: 'left',
                                cursor: locked ? 'not-allowed' : 'pointer',
                                border: sel
                                  ? '1.5px solid var(--accent)'
                                  : '0.5px solid var(--border-md)',
                                background: sel ? 'var(--accent-soft)' : 'var(--bg-card)',
                                opacity: locked ? 0.4 : 1,
                                transition: 'all 0.12s',
                              }}
                            >
                              <span aria-hidden="true" style={{ fontSize: '16px', flexShrink: 0 }}>
                                {p.icon}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: '12px',
                                    fontWeight: sel ? 500 : 400,
                                    color: sel ? 'var(--accent)' : 'var(--text)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {p.name}
                                </p>
                                <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-3)' }}>
                                  {p.durationMins < 60
                                    ? p.durationMins + 'm'
                                    : p.durationMins / 60 + 'h'}
                                </p>
                              </div>
                              {locked && (
                                <span style={{ marginLeft: 'auto', fontSize: '11px' }}>
                                  <span aria-hidden="true">🔒</span>
                                  <span className="sr-only">Locked</span>
                                </span>
                              )}
                            </button>
                            {!sel && onHideSuggestion && (
                              <button
                                type="button"
                                onClick={() => onHideSuggestion(p.id)}
                                aria-label={`Hide ${p.name} suggestion`}
                                title="Hide suggestion"
                                style={{
                                  position: 'absolute',
                                  top: '6px',
                                  right: '6px',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  border: 'none',
                                  background: 'var(--bg-metric)',
                                  color: 'var(--text-3)',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  lineHeight: 1,
                                }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {mode === 'manage' &&
        (selected.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-3)' }}>
              No activities added yet.
            </p>
            <button
              type="button"
              onClick={() => setMode('browse')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              Browse suggestions →
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selected.map(a => (
              <div
                key={a.id}
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border-md)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '10px',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: '18px' }}>
                    {a.icon}
                  </span>
                  <span
                    style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', flex: 1 }}
                  >
                    {a.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      aria-label={`${a.name}: 5 minutes shorter`}
                      onClick={() => updateDuration(a.id, a.durationMins - 5)}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        border: '0.5px solid var(--border-md)',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: '14px',
                        color: 'var(--text-2)',
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={a.durationMins}
                      aria-label={`${a.name} duration in minutes`}
                      onChange={e => updateDuration(a.id, parseInt(e.target.value) || 5)}
                      style={{
                        width: '44px',
                        textAlign: 'center',
                        fontSize: '12px',
                        padding: '2px 4px',
                        borderRadius: '5px',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>min</span>
                    <button
                      type="button"
                      aria-label={`${a.name}: 5 minutes longer`}
                      onClick={() => updateDuration(a.id, a.durationMins + 5)}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        border: '0.5px solid var(--border-md)',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: '14px',
                        color: 'var(--text-2)',
                      }}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => remove(a.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-3)',
                      fontSize: '16px',
                      minWidth: '24px',
                      height: '24px',
                      padding: '0 4px',
                    }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <div
                  role="group"
                  aria-label={`${a.name} sun protection`}
                  style={{ display: 'flex', gap: '8px' }}
                >
                  {[
                    { val: false, label: 'No SPF' },
                    { val: true, label: 'SPF 30+' },
                  ].map(o => (
                    <button
                      key={String(o.val)}
                      type="button"
                      aria-pressed={a.sunscreen === o.val}
                      onClick={() => updateSunscreen(a.id, o.val)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '9px',
                        cursor: 'pointer',
                        border:
                          a.sunscreen === o.val
                            ? '1.5px solid var(--accent)'
                            : '0.5px solid var(--border-md)',
                        background: a.sunscreen === o.val ? 'var(--accent-soft)' : 'transparent',
                        color: 'var(--text)',
                        fontSize: '12px',
                        fontWeight: 650,
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
