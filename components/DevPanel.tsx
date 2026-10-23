'use client'
import { useState, useEffect } from 'react'
import type { TierLevel } from '@/lib/types'

const KEY = 'solara_dev_tier'

export function getDevTierOverride(): TierLevel | null {
  if (typeof window === 'undefined') return null
  return (localStorage.getItem(KEY) as TierLevel) || null
}

interface Props {
  currentTier: TierLevel
  onOverride: (tier: TierLevel) => void
}

const TIERS: { value: TierLevel; label: string; emoji: string; desc: string }[] = [
  { value: 'anonymous', emoji: '👤', label: 'Anonymous', desc: 'No account, UV only' },
  { value: 'free', emoji: '🆓', label: 'Free', desc: '1 activity, calendar' },
  { value: 'paid', emoji: '⭐', label: 'Pro', desc: 'Unlimited, notifications' },
]

export default function DevPanel({ currentTier, onOverride }: Props) {
  const [open, setOpen] = useState(false)
  // Dev-only and client-only (rendered by components/App.tsx), so the stored
  // override is read on first render.
  const [active, setActive] = useState<TierLevel>(() => getDevTierOverride() ?? currentTier)

  useEffect(() => {
    const stored = getDevTierOverride()
    if (stored) onOverride(stored)
  }, [onOverride])

  function set(tier: TierLevel) {
    setActive(tier)
    localStorage.setItem(KEY, tier)
    onOverride(tier)
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {open && (
        <div
          style={{
            background: '#1A1A1A',
            borderRadius: '14px',
            padding: '14px',
            marginBottom: '8px',
            minWidth: '220px',
            border: '0.5px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <p
            style={{
              margin: '0 0 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Dev · Tier Preview
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {TIERS.map(t => (
              <button
                key={t.value}
                onClick={() => set(t.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background:
                    active === t.value ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.05)',
                  border:
                    active === t.value ? '1px solid rgba(249,115,22,0.5)' : '1px solid transparent',
                  transition: 'all 0.12s',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '16px' }}>{t.emoji}</span>
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '13px',
                      fontWeight: 500,
                      color: active === t.value ? '#FB923C' : '#E5E7EB',
                    }}
                  >
                    {t.label}
                  </p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6B7280' }}>{t.desc}</p>
                </div>
                {active === t.value && (
                  <span style={{ marginLeft: 'auto', fontSize: '14px', color: '#FB923C' }}>●</span>
                )}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: '10px',
              paddingTop: '10px',
              borderTop: '0.5px solid rgba(255,255,255,0.08)',
            }}
          >
            <p style={{ margin: 0, fontSize: '11px', color: '#4B5563' }}>
              Overrides stored in localStorage.
              <br />
              Clears on sign-in.
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#1A1A1A',
          border: '0.5px solid rgba(255,255,255,0.15)',
          borderRadius: '10px',
          padding: '7px 12px',
          cursor: 'pointer',
          color: '#FB923C',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ fontSize: '14px' }}>⚙️</span>
        Dev · {TIERS.find(t => t.value === active)?.label}
        <span style={{ fontSize: '10px', color: '#6B7280' }}>{open ? '▲' : '▼'}</span>
      </button>
    </div>
  )
}
