'use client'
import { X } from 'lucide-react'
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import Dialog, { useKeyboardScrollable } from './Dialog'

interface Props {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}

export default function ActivityModalShell({
  title,
  description,
  children,
  footer,
  onClose,
}: Props) {
  const titleId = useId()
  const descriptionId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyTabIndex = useKeyboardScrollable(bodyRef)

  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b-[0.5px] border-line-strong px-[22px] pt-5 pb-4">
        <div>
          <h2 id={titleId} className="text-[18px] font-[750] text-ink">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-[5px] text-[13px] leading-[1.45] text-ink-3">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-metric text-[18px] text-ink-2"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div
        ref={bodyRef}
        tabIndex={bodyTabIndex}
        role={bodyTabIndex === undefined ? undefined : 'region'}
        aria-labelledby={bodyTabIndex === undefined ? undefined : titleId}
        className="min-h-0 flex-1 overflow-y-auto px-[22px] py-5"
      >
        <div>{children}</div>
      </div>

      {footer && (
        <div className="shrink-0 border-t-[0.5px] border-line-strong px-[22px] py-[15px]">
          {footer}
        </div>
      )}
    </Dialog>
  )
}
