'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  icon: string
  title: string
  children: ReactNode
  /** The offer itself: a sign-in button or a button that opens the Pro plans. */
  action: ReactNode
  /** "Not now": the caller remembers it on this device (lib/upsell.ts). */
  onDismiss: () => void
  /** Moves keyboard focus to the card when it appears in answer to an action. */
  focusOnShow?: boolean
}

/**
 * A gentle, inline upsell (decision D7): never a pop-up, announced politely when it
 * appears, and dismissible with "Not now".
 */
export default function Upsell({ icon, title, children, action, onDismiss, focusOnShow }: Props) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusOnShow) ref.current?.focus()
  }, [focusOnShow])

  return (
    <div
      ref={ref}
      role="status"
      aria-labelledby={titleId}
      tabIndex={focusOnShow ? -1 : undefined}
      data-testid="upsell"
      className="card border-[0.5px] border-brand/30 bg-transparent bg-[linear-gradient(180deg,rgba(249,115,22,0.09),rgba(249,115,22,0.03))] outline-offset-2"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="shrink-0 text-[24px] leading-none">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p id={titleId} className="text-[15px] font-bold text-ink">
            {title}
          </p>
          <p className="mt-1 text-[13px] leading-[1.5] text-ink-2">{children}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {action}
            <button
              type="button"
              aria-describedby={titleId}
              className="btn btn-ghost px-3 py-[9px] text-[13px] text-ink-2"
              onClick={onDismiss}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
