'use client'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
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
    <div className="fixed right-4 bottom-4 z-[999] font-sans">
      {open && (
        <div className="mb-2 min-w-[220px] rounded-[14px] border-[0.5px] border-white/12 bg-[#1a1a1a] p-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="mb-2.5 text-[11px] font-semibold tracking-[0.08em] text-[#888] uppercase">
            Dev · Tier Preview
          </p>
          <div className="flex flex-col gap-1">
            {TIERS.map(t => {
              const selected = active === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => set(t.value)}
                  className={clsx(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-[9px] text-left transition-all duration-[120ms]',
                    selected
                      ? 'border-[rgba(249,115,22,0.5)] bg-[rgba(249,115,22,0.2)]'
                      : 'border-transparent bg-white/5',
                  )}
                >
                  <span className="text-[16px]">{t.emoji}</span>
                  <div>
                    <p
                      className={clsx(
                        'text-[13px] font-medium',
                        selected ? 'text-[#fb923c]' : 'text-[#e5e7eb]',
                      )}
                    >
                      {t.label}
                    </p>
                    <p className="text-[11px] text-[#6b7280]">{t.desc}</p>
                  </div>
                  {selected && <span className="ml-auto text-[14px] text-[#fb923c]">●</span>}
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 border-t-[0.5px] border-white/8 pt-2.5">
            <p className="text-[11px] text-[#4b5563]">
              Overrides stored in localStorage.
              <br />
              Clears on sign-in.
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-[10px] border-[0.5px] border-white/15 bg-[#1a1a1a] px-3 py-[7px] text-[12px] font-semibold text-[#fb923c] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
      >
        <span className="text-[14px]">⚙️</span>
        Dev · {TIERS.find(t => t.value === active)?.label}
        <span className="text-[10px] text-[#6b7280]">{open ? '▲' : '▼'}</span>
      </button>
    </div>
  )
}
