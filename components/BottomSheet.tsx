import type { ReactNode, Ref } from 'react'
import clsx from 'clsx'

/** Full-width action button inside a bottom sheet's action grid. */
export const sheetAction = 'btn justify-center min-h-10 no-underline'

/**
 * A non-modal bottom sheet: the calendar's window details and a scheduled
 * activity's details. The page stays usable behind it; the opener moves focus in
 * and handles Escape.
 */
export default function BottomSheet({
  ref,
  labelledBy,
  testId,
  children,
}: {
  ref?: Ref<HTMLDivElement>
  labelledBy: string
  testId: string
  children: ReactNode
}) {
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      data-testid={testId}
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-60 mx-auto max-w-[520px] rounded-2xl border-[0.5px] border-line-strong bg-surface-card p-4 shadow-[0_12px_40px_rgba(0,0,0,0.22)] outline-none"
    >
      {children}
    </div>
  )
}

/** The sheet's ✕ button. */
export function SheetClose({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-ghost min-h-8 min-w-8 px-2 py-1 text-[14px]"
      aria-label="Close"
      onClick={onClose}
      disabled={disabled}
    >
      ✕
    </button>
  )
}

/** The two-column grid of sheet actions; a single column when there is one action. */
export function SheetActions({ single, children }: { single?: boolean; children: ReactNode }) {
  return (
    <div className={clsx('mt-3.5 grid gap-2', single ? 'grid-cols-[1fr]' : 'grid-cols-[1fr_1fr]')}>
      {children}
    </div>
  )
}
