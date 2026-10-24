'use client'
import clsx from 'clsx'
import { useId, useState } from 'react'
import EmojiPicker from './EmojiPicker'

interface Props {
  value: string
  onChange: (icon: string) => void
  /** Accessible name of the button. */
  label: string
  size?: 'md' | 'lg'
}

/** A button showing an activity's icon that opens the emoji picker below it. */
export default function ActivityIconButton({ value, onChange, label, size = 'md' }: Props) {
  const [open, setOpen] = useState(false)
  const pickerId = useId()

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? pickerId : undefined}
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'flex items-center justify-center border-[0.5px] border-line-strong bg-surface-card',
          size === 'lg'
            ? 'size-[50px] rounded-[14px] text-[25px]'
            : 'size-11 rounded-[10px] text-[22px]',
        )}
      >
        {value}
      </button>
      {open && (
        <EmojiPicker
          id={pickerId}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
