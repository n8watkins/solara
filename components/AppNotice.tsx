import type { ReactNode } from 'react'
import clsx from 'clsx'

const TONES = {
  /** Warm notice: sync problems, the morning summary. */
  notice: 'border-notice-border bg-notice text-notice-ink',
  /** Neutral progress: checkout confirmation. */
  info: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1e40af] dark:border-[#1e3a8a] dark:bg-[#111b2e] dark:text-[#93c5fd]',
  /** Something failed: the forecast could not load. */
  error:
    'border-[#fecaca] bg-[#fef2f2] text-[#991b1b] dark:border-[#7f1d1d] dark:bg-[#2a1414] dark:text-[#fca5a5]',
} as const

/** A full-width banner above the signed-in app's content. */
export default function AppNotice({
  tone,
  icon,
  role,
  action,
  children,
}: {
  tone: keyof typeof TONES
  /** An emoji or an icon element, shown before the text. */
  icon?: ReactNode
  role?: 'status' | 'alert'
  /** A small button at the end of the banner (Retry, Dismiss, ...). */
  action?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  return (
    <div
      role={role}
      className={clsx(
        'mb-4 flex items-center gap-2.5 rounded-xl border-[0.5px] px-4 py-3 text-[14px]',
        TONES[tone],
      )}
    >
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="flex-1">{children}</span>
      {action && (
        <button className="btn text-[12px]" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
