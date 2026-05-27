'use client'
import { useState } from 'react'
import { Activity } from '@/lib/types'
import { PRESET_ACTIVITIES, canAddActivity } from '@/lib/tiers'
import { TierLevel } from '@/lib/types'

interface Props {
  selected: Activity[]
  tier: TierLevel
  onChange: (activities: Activity[]) => void
}

export default function ActivityManager({ selected, tier, onChange }: Props) {
  const [customName, setCustomName]   = useState('')
  const [customMins, setCustomMins]   = useState(30)
  const [showCustom, setShowCustom]   = useState(false)
  const [customIcon, setCustomIcon]   = useState('🏋️')

  const ICONS = ['🏋️','🤸','⛷️','🏄','🧗','🤾','🏇','🎿','🛶','🏕️','🌿','🐕']

  function isSelected(id: string) {
    return selected.some(a => a.id === id)
  }

  function togglePreset(preset: typeof PRESET_ACTIVITIES[0]) {
    if (isSelected(preset.id)) {
      onChange(selected.filter(a => a.id !== preset.id))
    } else {
      if (!canAddActivity(tier, selected.length)) return
      onChange([...selected, { ...preset }])
    }
  }

  function addCustom() {
    if (!customName.trim()) return
    if (!canAddActivity(tier, selected.length)) return
    const id = `custom_${Date.now()}`
    onChange([...selected, {
      id, name: customName.trim(), icon: customIcon,
      durationMins: customMins, maxUV: 4, custom: true,
    }])
    setCustomName('')
    setCustomMins(30)
    setShowCustom(false)
  }

  function updateDuration(id: string, mins: number) {
    onChange(selected.map(a => a.id === id ? { ...a, durationMins: Math.max(5, mins) } : a))
  }

  function remove(id: string) {
    onChange(selected.filter(a => a.id !== id))
  }

  const atLimit = !canAddActivity(tier, selected.length)

  return (
    <div>
      <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.5' }}>
        {tier === 'anonymous'
          ? 'Create an account to track activities and get safe window alerts.'
          : tier === 'free'
            ? `Free plan: 1 activity. ${atLimit ? 'Upgrade for more.' : 'Pick one to get started.'}`
            : 'Pick as many as you like.'}
      </p>

      <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
        Presets
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', marginBottom: '16px' }}>
        {PRESET_ACTIVITIES.map(p => {
          const sel = isSelected(p.id)
          const locked = !sel && atLimit
          return (
            <button
              key={p.id}
              onClick={() => togglePreset(p)}
              disabled={locked}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', borderRadius: '10px', textAlign: 'left',
                border: sel ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                background: sel ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '18px' }}>{p.icon}</span>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{p.name}</p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-3)' }}>{p.durationMins < 60 ? p.durationMins + 'm' : p.durationMins / 60 + 'h'}</p>
              </div>
              {locked && <span style={{ marginLeft: 'auto', fontSize: '12px' }}>🔒</span>}
            </button>
          )
        })}
      </div>

      {!atLimit && (
        <div style={{ marginBottom: '16px' }}>
          {!showCustom ? (
            <button className="btn" onClick={() => setShowCustom(true)} style={{ fontSize: '13px' }}>
              + Add custom activity
            </button>
          ) : (
            <div style={{ background: 'var(--bg-metric)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>Custom activity</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {ICONS.map(ic => (
                  <button key={ic} onClick={() => setCustomIcon(ic)} style={{
                    fontSize: '20px', padding: '4px 6px', borderRadius: '6px',
                    border: customIcon === ic ? '1.5px solid var(--accent)' : '0.5px solid var(--border)',
                    background: customIcon === ic ? 'rgba(249,115,22,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}>{ic}</button>
                ))}
              </div>
              <input
                placeholder="Activity name"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom()}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Duration (min)</span>
                <input
                  type="number" min="5" step="5" value={customMins}
                  onChange={e => setCustomMins(Math.max(5, parseInt(e.target.value) || 5))}
                  style={{ width: '80px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-primary" onClick={addCustom} style={{ fontSize: '13px' }}>Add</button>
                <button className="btn" onClick={() => setShowCustom(false)} style={{ fontSize: '13px' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div>
          <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Your activities
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {selected.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px', borderRadius: '10px',
                background: 'var(--bg-card)', border: '0.5px solid var(--border-md)',
              }}>
                <span style={{ fontSize: '18px' }}>{a.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', flex: 1 }}>{a.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => updateDuration(a.id, a.durationMins - 15)}
                    style={{ width: '24px', height: '24px', borderRadius: '6px', border: '0.5px solid var(--border-md)', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: '14px' }}>−</button>
                  <span style={{ fontSize: '12px', color: 'var(--text-2)', minWidth: '40px', textAlign: 'center' }}>
                    {a.durationMins < 60 ? a.durationMins + 'm' : a.durationMins / 60 + 'h'}
                  </span>
                  <button onClick={() => updateDuration(a.id, a.durationMins + 15)}
                    style={{ width: '24px', height: '24px', borderRadius: '6px', border: '0.5px solid var(--border-md)', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: '14px' }}>+</button>
                </div>
                <button onClick={() => remove(a.id)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '16px', padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
