'use client'
import clsx from 'clsx'
import type { Profile, SkinType } from '@/lib/types'
import { FITZPATRICK_TYPES } from '@solara/core'
import { SKIN_TYPE_LABELS } from '@/lib/profiles'

const SKIN_TYPES = Object.keys(SKIN_TYPE_LABELS) as SkinType[]
const ICON_CHOICES = ['🧑', '👧', '👦', '👩', '👨', '👴', '👵', '🐕', '🐈']

interface Props {
  /** Prefix for the ids that tie the hidden labels to their fields. */
  labelPrefix: string
  draft: Profile
  isNew: boolean
  onChange: (profile: Profile) => void
  onSave: () => void
  onCancel: () => void
  /** Only saved profiles can be deleted. */
  onDelete?: () => void
}

/** The add or edit form inside the profile switcher: icon, name and skin type. */
export default function ProfileEditor({
  labelPrefix,
  draft,
  isNew,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  return (
    <div className="flex flex-col gap-2.5">
      <div role="group" aria-label="Icon" className="flex flex-wrap gap-1.5">
        {ICON_CHOICES.map(icon => {
          const selected = draft.icon === icon
          return (
            <button
              key={icon}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ ...draft, icon })}
              className={clsx(
                'size-[30px] rounded-lg text-[16px]',
                selected
                  ? 'border-[1.5px] border-accent bg-accent-soft'
                  : 'border-[0.5px] border-line-strong bg-surface-card',
              )}
            >
              {icon}
            </button>
          )
        })}
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
        className="box-border w-full px-2.5 py-2 text-[14px]"
      />
      <label className="sr-only" htmlFor={`${labelPrefix}-skin`}>
        Skin type
      </label>
      <select
        id={`${labelPrefix}-skin`}
        value={draft.skinType}
        onChange={e => onChange({ ...draft, skinType: e.target.value as SkinType })}
        className="p-[7px] text-[13px]"
      >
        {SKIN_TYPES.map(skinType => (
          <option key={skinType} value={skinType}>
            {SKIN_TYPE_LABELS[skinType]} skin (Type {FITZPATRICK_TYPES[skinType]})
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        {onDelete && (
          <button
            type="button"
            className="btn border-danger/30 text-[12px] text-danger"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn text-[12px]" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary text-[12px]"
            onClick={onSave}
            disabled={!draft.name.trim()}
          >
            {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
