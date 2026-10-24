'use client'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface SectionProps {
  /** id of the title; the description gets `${id}-desc`. */
  id: string
  title: ReactNode
  description: ReactNode
  /** A control beside the title, such as an on/off toggle. */
  aside?: ReactNode
  /** Span every column of the editor grid. */
  wide?: boolean
  children?: ReactNode
}

/** One titled card in the Edit activity form. */
export function ActivityEditSection({
  id,
  title,
  description,
  aside,
  wide,
  children,
}: SectionProps) {
  return (
    <div className={clsx('metric-card flex flex-col gap-3', wide && 'col-span-full')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={id} className="mb-1 text-[13px] font-bold text-ink">
            {title}
          </h3>
          <p id={`${id}-desc`} className="text-[13px] leading-[1.45] text-ink-3">
            {description}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

interface ToggleProps {
  on: boolean
  onToggle: () => void
  children: ReactNode
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/** A small on/off button for a section's `aside`, filled while on. */
export function SectionToggle({ on, onToggle, children, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={clsx('btn text-[12px] whitespace-nowrap', on && 'btn-primary')}
      {...rest}
    >
      {children}
    </button>
  )
}
