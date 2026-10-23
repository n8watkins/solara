'use client'
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          padding: '20px 22px 16px',
          borderBottom: '0.5px solid var(--border-md)',
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: '18px', fontWeight: 750, color: 'var(--text)' }}
          >
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              style={{
                margin: '5px 0 0',
                fontSize: '13px',
                color: 'var(--text-3)',
                lineHeight: 1.45,
              }}
            >
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'var(--bg-metric)',
            border: 'none',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            fontSize: '18px',
            cursor: 'pointer',
            color: 'var(--text-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label="Close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div
        ref={bodyRef}
        tabIndex={bodyTabIndex}
        role={bodyTabIndex === undefined ? undefined : 'region'}
        aria-labelledby={bodyTabIndex === undefined ? undefined : titleId}
        style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '20px 22px' }}
      >
        <div>{children}</div>
      </div>

      {footer && (
        <div
          style={{
            padding: '15px 22px',
            borderTop: '0.5px solid var(--border-md)',
            flexShrink: 0,
          }}
        >
          {footer}
        </div>
      )}
    </Dialog>
  )
}
