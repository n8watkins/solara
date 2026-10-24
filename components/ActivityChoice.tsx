'use client'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface ChoiceButtonProps {
  pressed: boolean
  onClick: () => void
  /** Smaller text and padding, for dense lists. */
  compact?: boolean
  title?: string
  children: ReactNode
}

/** One option in a row of mutually exclusive choices, shown as a pressed toggle. */
export function ChoiceButton({ pressed, onClick, compact, title, children }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={clsx(
        'flex-1 rounded-[10px] px-2.5 font-[650] text-ink',
        compact ? 'py-2 text-[12px]' : 'py-[9px] text-[13px]',
        pressed
          ? 'border-[1.5px] border-accent bg-accent-soft'
          : 'border-[0.5px] border-line-strong bg-surface-card',
      )}
    >
      {children}
    </button>
  )
}

type GroupName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never }

type SunscreenChoiceProps = GroupName & {
  value: boolean
  onChange: (sunscreen: boolean) => void
  'aria-describedby'?: string
  compact?: boolean
}

const SUNSCREEN_OPTIONS = [
  { value: false, label: 'No SPF' },
  { value: true, label: 'SPF 30+' },
] as const

/** The No SPF / SPF 30+ choice for an activity. */
export function SunscreenChoice({ value, onChange, compact, ...aria }: SunscreenChoiceProps) {
  return (
    <div role="group" {...aria} className="flex gap-2">
      {SUNSCREEN_OPTIONS.map(option => (
        <ChoiceButton
          key={String(option.value)}
          pressed={value === option.value}
          onClick={() => onChange(option.value)}
          compact={compact}
        >
          {option.label}
        </ChoiceButton>
      ))}
    </div>
  )
}
