'use client'
import { useState } from 'react'
import { Activity } from '@/lib/types'
import { ACTIVITY_CATEGORIES, canAddActivity, TIER_LIMITS } from '@/lib/tiers'
import { TierLevel } from '@/lib/types'
import EmojiPicker from './EmojiPicker'

interface Props {
  selected: Activity[]
  tier: TierLevel
  onChange: (activities: Activity[]) => void
}

export default function ActivityManager({ selected, tier, onChange }: Props) {
  const [search,      setSearch]      = useState('')
  const [showCreate,  setShowCreate]  = useState(false)
  const [customName,  setCustomName]  = useState('')
  const [customMins,  setCustomMins]  = useState(30)
  const [customIcon,  setCustomIcon]  = useState('🏃')
  const [customSunscreen, setCustomSunscreen] = useState(false)
  const [showEmoji,   setShowEmoji]   = useState(false)

  const atLimit = !canAddActivity(tier, selected.length)

  function isSelected(id: string) { return selected.some(a => a.id === id) }

  function toggle(preset: { id: string; name: string; icon: string; durationMins: number; maxUV: number }) {
    if (isSelected(preset.id)) {
      onChange(selected.filter(a => a.id !== preset.id))
    } else {
      if (atLimit) return
      onChange([...selected, { ...preset, sunscreen: false }])
    }
  }

  function addCustom() {
    if (!customName.trim() || atLimit) return
    onChange([...selected, {
      id: `custom_${Date.now()}`, name: customName.trim(),
      icon: customIcon, durationMins: customMins, maxUV: 4,
      sunscreen: customSunscreen, custom: true,
    }])
    setCustomName(''); setCustomMins(30); setCustomSunscreen(false); setShowCreate(false)
  }

  function updateDuration(id: string, mins: number) {
    onChange(selected.map(a => a.id === id ? { ...a, durationMins: Math.max(5, mins) } : a))
  }

  function updateSunscreen(id: string, sunscreen: boolean) {
    onChange(selected.map(a => a.id === id ? { ...a, sunscreen } : a))
  }

  function remove(id: string) { onChange(selected.filter(a => a.id !== id)) }

  const filteredCats = search
    ? [{ name: 'Results', emoji: '🔍', activities: ACTIVITY_CATEGORIES.flatMap(c => c.activities).filter(a => a.name.toLowerCase().includes(search.toLowerCase())) }]
    : ACTIVITY_CATEGORIES

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {atLimit && tier !== 'paid' && (
        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(249,115,22,0.08)', border: '0.5px solid rgba(249,115,22,0.2)', fontSize: '13px', color: 'var(--text-2)' }}>
          {tier === 'anonymous' ? '👤 Create an account to add activities.' : `🆓 Free plan: ${TIER_LIMITS.free.activities} activities. Upgrade to Pro for unlimited.`}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', fontSize: '14px', padding: '10px', borderRadius: '12px' }}
          disabled={atLimit}
        >
          {showCreate ? '✕ Cancel' : '+ Create custom activity'}
        </button>

        {showCreate && (
          <div style={{ marginTop: '10px', padding: '14px', borderRadius: '12px', background: 'var(--bg-metric)', border: '0.5px solid var(--border-md)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowEmoji(s => !s)}
                  style={{ width: '44px', height: '44px', fontSize: '22px', borderRadius: '10px', border: '0.5px solid var(--border-md)', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {customIcon}
                </button>
                {showEmoji && (
                  <EmojiPicker value={customIcon} onChange={setCustomIcon} onClose={() => setShowEmoji(false)} />
                )}
              </div>
              <input
                placeholder="Activity name"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom()}
                style={{ flex: 1, fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-2)', flexShrink: 0 }}>Duration</span>
              <input type="number" min="5" step="5" value={customMins} onChange={e => setCustomMins(Math.max(5, parseInt(e.target.value) || 5))} style={{ width: '80px', fontSize: '13px' }} />
              <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>min</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { val: false, label: 'No SPF' },
                { val: true, label: 'SPF 30+' },
              ].map(o => (
                <button
                  key={String(o.val)}
                  onClick={() => setCustomSunscreen(o.val)}
                  style={{
                    flex: 1,
                    padding: '9px 10px',
                    borderRadius: '10px',
                    border: customSunscreen === o.val ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                    background: customSunscreen === o.val ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
                    color: 'var(--text)',
                    fontSize: '13px',
                    fontWeight: 650,
                    cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={addCustom} disabled={!customName.trim()} style={{ justifyContent: 'center' }}>
              Add activity
            </button>
          </div>
        )}
      </div>

      <input
        placeholder="Search activities..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', padding: '8px 12px' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredCats.map(cat => (
          <div key={cat.name}>
            <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {cat.emoji} {cat.name}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px' }}>
              {cat.activities.map(p => {
                const sel    = isSelected(p.id)
                const locked = !sel && atLimit
                return (
                  <button key={p.id} onClick={() => toggle(p)} disabled={locked} style={{
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '8px 10px', borderRadius: '9px', textAlign: 'left', cursor: locked ? 'not-allowed' : 'pointer',
                    border: sel ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                    background: sel ? 'rgba(249,115,22,0.07)' : 'var(--bg-card)',
                    opacity: locked ? 0.4 : 1, transition: 'all 0.12s',
                  }}>
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>{p.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '12px', fontWeight: sel ? 500 : 400, color: sel ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
                      <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-3)' }}>{p.durationMins < 60 ? p.durationMins + 'm' : p.durationMins / 60 + 'h'}</p>
                    </div>
                    {locked && <span style={{ marginLeft: 'auto', fontSize: '11px' }}>🔒</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selected.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Your activities ({selected.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selected.map(a => (
              <div key={a.id} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-md)', borderRadius: '10px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '18px' }}>{a.icon}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', flex: 1 }}>{a.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button onClick={() => updateDuration(a.id, a.durationMins - 15)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: '0.5px solid var(--border-md)', background: 'transparent', cursor: 'pointer', fontSize: '14px', color: 'var(--text-2)' }}>−</button>
                    <span style={{ fontSize: '12px', color: 'var(--text-2)', minWidth: '36px', textAlign: 'center' }}>{a.durationMins < 60 ? a.durationMins + 'm' : a.durationMins / 60 + 'h'}</span>
                    <button onClick={() => updateDuration(a.id, a.durationMins + 15)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: '0.5px solid var(--border-md)', background: 'transparent', cursor: 'pointer', fontSize: '14px', color: 'var(--text-2)' }}>+</button>
                  </div>
                  <button onClick={() => remove(a.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '16px', padding: '0 4px' }}>×</button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { val: false, label: 'No SPF' },
                    { val: true, label: 'SPF 30+' },
                  ].map(o => (
                    <button
                      key={String(o.val)}
                      onClick={() => updateSunscreen(a.id, o.val)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '9px',
                        border: a.sunscreen === o.val ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                        background: a.sunscreen === o.val ? 'rgba(249,115,22,0.08)' : 'transparent',
                        color: 'var(--text)',
                        cursor: 'pointer',
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
        </div>
      )}
    </div>
  )
}
