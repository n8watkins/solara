'use client'
import { useState, useRef, useEffect, useId } from 'react'
import type { UserPreferences, Profile, SkinType, TierLevel } from '@/lib/types'
import { activeProfile, defaultProfile, selectProfile, SKIN_TYPE_LABELS } from '@/lib/profiles'
import { getProfileLimit } from '@/lib/tiers'

interface Props {
  prefs: UserPreferences
  tier: TierLevel
  onApply: (patch: Partial<UserPreferences>) => void
}

const SKIN_TYPES = Object.keys(SKIN_TYPE_LABELS) as SkinType[]
const ICON_CHOICES = ['🧑', '👧', '👦', '👩', '👨', '👴', '👵', '🐕', '🐈']

function newId() {
  return `profile_${Date.now().toString(36)}`
}

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

  function startAdd() {
    setEditing({ id: newId(), name: '', skinType: prefs.skinType, icon: '🧑' })
  }

  function saveProfile(p: Profile) {
    if (!p.name.trim()) return
    // Seed the implicit "Me" into storage the first time a second profile is created.
    const base = saved.length ? saved : [{ ...defaultProfile(prefs.skinType) }]
    const exists = base.some(e => e.id === p.id)
    const profiles = exists ? base.map(e => (e.id === p.id ? p : e)) : [...base, p]
    const patch: Partial<UserPreferences> = { profiles }
    // Editing the active profile updates the live skin type too.
    if (p.id === active.id) patch.skinType = p.skinType
    onApply(patch)
    setEditing(null)
  }

  function removeProfile(id: string) {
    const profiles = saved.filter(p => p.id !== id)
    const patch: Partial<UserPreferences> = { profiles: profiles.length ? profiles : undefined }
    if (id === active.id) {
      const fallback = profiles[0]
      patch.activeProfileId = fallback?.id
      if (fallback) patch.skinType = fallback.skinType
    }
    onApply(patch)
  }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-block' }}
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          background: 'var(--bg-metric)',
          border: '0.5px solid var(--border-md)',
          borderRadius: '999px',
          cursor: 'pointer',
          padding: '4px 9px 4px 7px',
          fontSize: '12px',
          color: 'var(--text-2)',
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '13px' }}>
          {active.icon ?? '🧑'}
        </span>
        <span style={{ fontWeight: 600 }}>{active.name}</span>
        <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 100,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border-md)',
            borderRadius: '14px',
            padding: '12px',
            width: '260px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: '0 0 8px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Profiles
          </h2>

          {!editing && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  marginBottom: '8px',
                }}
              >
                {list.map(p => {
                  const isActive = p.id === active.id
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => switchTo(p)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          textAlign: 'left',
                          background: isActive ? 'var(--accent-soft)' : 'none',
                          border: isActive
                            ? '1px solid var(--accent-border)'
                            : '1px solid transparent',
                          borderRadius: '9px',
                          cursor: 'pointer',
                          padding: '7px 9px',
                        }}
                      >
                        <span aria-hidden="true" style={{ fontSize: '16px' }}>
                          {p.icon ?? '🧑'}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '13px',
                              fontWeight: 600,
                              color: 'var(--text)',
                            }}
                          >
                            {p.name}
                          </span>
                          <span
                            style={{ display: 'block', fontSize: '11px', color: 'var(--text-3)' }}
                          >
                            {SKIN_TYPE_LABELS[p.skinType]} skin
                          </span>
                        </span>
                        {isActive && (
                          <span
                            aria-hidden="true"
                            style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 700 }}
                          >
                            Active
                          </span>
                        )}
                      </button>
                      {saved.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-3)',
                            fontSize: '13px',
                            minWidth: '28px',
                            minHeight: '28px',
                            padding: '4px',
                            borderRadius: '7px',
                          }}
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
                  className="btn"
                  onClick={startAdd}
                  style={{ width: '100%', justifyContent: 'center', fontSize: '13px' }}
                >
                  ＋ Add person or pet
                </button>
              ) : (
                <p
                  style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.45 }}
                >
                  {limit === 1
                    ? '🔒 Family & pet profiles are a Pro feature.'
                    : `Profile limit reached (${limit}).`}
                </p>
              )}
            </>
          )}

          {editing && (
            <ProfileEditor
              draft={editing}
              isNew={!saved.some(p => p.id === editing.id)}
              onChange={setEditing}
              onSave={() => saveProfile(editing)}
              onCancel={() => setEditing(null)}
              labelPrefix={id}
              onDelete={
                saved.some(p => p.id === editing.id)
                  ? () => {
                      removeProfile(editing.id)
                      setEditing(null)
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

function ProfileEditor({
  draft,
  isNew,
  onChange,
  onSave,
  onCancel,
  onDelete,
  labelPrefix,
}: {
  labelPrefix: string
  draft: Profile
  isNew: boolean
  onChange: (p: Profile) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div role="group" aria-label="Icon" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {ICON_CHOICES.map(ic => (
          <button
            key={ic}
            type="button"
            aria-pressed={draft.icon === ic}
            onClick={() => onChange({ ...draft, icon: ic })}
            style={{
              width: '30px',
              height: '30px',
              fontSize: '16px',
              borderRadius: '8px',
              cursor: 'pointer',
              border:
                draft.icon === ic ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
              background: draft.icon === ic ? 'var(--accent-soft)' : 'var(--bg-card)',
            }}
          >
            {ic}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${labelPrefix}-name`}>
        Name
      </label>
      <input
        id={`${labelPrefix}-name`}
        value={draft.name}
        onChange={e => onChange({ ...draft, name: e.target.value })}
        placeholder="Name (e.g. Ava, Rex)"
        autoFocus
        style={{ width: '100%', boxSizing: 'border-box', fontSize: '14px', padding: '8px 10px' }}
      />
      <label className="sr-only" htmlFor={`${labelPrefix}-skin`}>
        Skin type
      </label>
      <select
        id={`${labelPrefix}-skin`}
        value={draft.skinType}
        onChange={e => onChange({ ...draft, skinType: e.target.value as SkinType })}
        style={{ fontSize: '13px', padding: '7px' }}
      >
        {SKIN_TYPES.map(st => (
          <option key={st} value={st}>
            {SKIN_TYPE_LABELS[st]} skin
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: '8px' }}>
        {onDelete && (
          <button
            type="button"
            className="btn"
            onClick={onDelete}
            style={{ color: 'var(--danger)', borderColor: '#FECACA', fontSize: '12px' }}
          >
            Delete
          </button>
        )}
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button type="button" className="btn" onClick={onCancel} style={{ fontSize: '12px' }}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={!draft.name.trim()}
            style={{ fontSize: '12px' }}
          >
            {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
