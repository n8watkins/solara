'use client'
import { useState, useRef, useEffect, useId } from 'react'
import clsx from 'clsx'
import type { UserPreferences, Profile, TierLevel } from '@/lib/types'
import { activeProfile, defaultProfile, selectProfile, SKIN_TYPE_LABELS } from '@/lib/profiles'
import { newProfileDraft, removeProfilePatch, saveProfilePatch } from '@/lib/profile-patches'
import { getProfileLimit } from '@/lib/tiers'
import ProfileEditor from './ProfileEditor'

interface Props {
  prefs: UserPreferences
  tier: TierLevel
  onApply: (patch: Partial<UserPreferences>) => void
}

/**
 * The header's profile picker: switch between the people (and pets) Solara
 * plans for, and add, edit or remove them. A disclosure panel that closes on
 * Escape, an outside click or tabbing away.
 */
export default function ProfileSwitcher({ prefs, tier, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null) // profile being edited, or a blank draft for "add"
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const panelId = `${id}-panel`
  const titleId = `${id}-title`

  function close({ returnFocus }: { returnFocus: boolean }) {
    setOpen(false)
    setEditing(null)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const saved = prefs.profiles ?? []
  // Always show at least the implicit "Me" so the control is meaningful before setup.
  const list: Profile[] = saved.length ? saved : [defaultProfile(prefs.skinType)]
  const active = activeProfile(prefs)
  const limit = getProfileLimit(tier)
  const canAdd = saved.length < limit

  function switchTo(p: Profile) {
    onApply(selectProfile(p))
    close({ returnFocus: true })
  }

  function saveProfile(p: Profile) {
    if (!p.name.trim()) return
    onApply(saveProfilePatch(prefs, p))
    setEditing(null)
  }

  function removeProfile(id: string) {
    onApply(removeProfilePatch(prefs, id))
    setEditing(null)
  }

  return (
    <div
      ref={ref}
      className="relative inline-block"
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close({ returnFocus: true })
        }
      }}
      onBlur={event => {
        // Tabbing out of the switcher closes it, like a click outside does.
        if (open && !ref.current?.contains(event.relatedTarget as Node | null)) {
          close({ returnFocus: false })
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`Profile: ${active.name}`}
        onClick={() => setOpen(o => !o)}
        title="Switch profile"
        className="flex items-center gap-[5px] rounded-full border-[0.5px] border-line-strong bg-surface-metric py-1 pr-[9px] pl-[7px] text-[12px] whitespace-nowrap text-ink-2"
      >
        <span aria-hidden="true" className="text-[13px]">
          {active.icon ?? '🧑'}
        </span>
        <span className="font-semibold">{active.name}</span>
        <span aria-hidden="true" className="text-ink-3">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute top-[calc(100%+6px)] right-0 z-100 w-65 rounded-[14px] border-[0.5px] border-line-strong bg-surface-card p-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
        >
          <h2
            id={titleId}
            className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink uppercase"
          >
            Profiles
          </h2>

          {editing ? (
            <ProfileEditor
              labelPrefix={id}
              draft={editing}
              isNew={!saved.some(p => p.id === editing.id)}
              onChange={setEditing}
              onSave={() => saveProfile(editing)}
              onCancel={() => setEditing(null)}
              onDelete={
                saved.some(p => p.id === editing.id) ? () => removeProfile(editing.id) : undefined
              }
            />
          ) : (
            <>
              <div className="mb-2 flex flex-col gap-[3px]">
                {list.map(p => {
                  const isActive = p.id === active.id
                  return (
                    <div key={p.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => switchTo(p)}
                        className={clsx(
                          'flex flex-1 items-center gap-2 rounded-[9px] border px-[9px] py-[7px] text-left',
                          isActive ? 'border-accent-border bg-accent-soft' : 'border-transparent',
                        )}
                      >
                        <span aria-hidden="true" className="text-[16px]">
                          {p.icon ?? '🧑'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink">{p.name}</span>
                          <span className="block text-[11px] text-ink-3">
                            {SKIN_TYPE_LABELS[p.skinType]} skin
                          </span>
                        </span>
                        {isActive && (
                          <span aria-hidden="true" className="text-[11px] font-bold text-accent">
                            Active
                          </span>
                        )}
                      </button>
                      {saved.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          className="min-h-7 min-w-7 rounded-[7px] p-1 text-[13px] text-ink-3"
                        >
                          <span aria-hidden="true">✎</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {canAdd ? (
                <button
                  type="button"
                  className="btn w-full justify-center text-[13px]"
                  onClick={() => setEditing(newProfileDraft(prefs))}
                >
                  ＋ Add person or pet
                </button>
              ) : (
                <p className="text-[12px] leading-[1.45] text-ink-3">
                  {limit === 1
                    ? '🔒 Family & pet profiles are a Pro feature.'
                    : `Profile limit reached (${limit}).`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
