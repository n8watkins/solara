'use client'
import { ReactNode } from 'react'
import { useBodyScrollLock } from '@/lib/useBodyScrollLock'

interface Props {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}

export default function ActivityModalShell({ title, description, children, footer, onClose }: Props) {
  useBodyScrollLock()
  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: '820px',
        maxHeight: 'min(88vh, 760px)',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border-md)',
        borderRadius: '20px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.24)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          padding: '20px 22px 16px',
          borderBottom: '0.5px solid var(--border-md)',
          flexShrink: 0,
        }}>
          <div>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 750, color: 'var(--text)' }}>{title}</p>
            {description && (
              <p style={{ margin: '5px 0 0', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}>{description}</p>
            )}
          </div>
          <button
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
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 22px' }}>
          {children}
        </div>

        {footer && (
          <div style={{ padding: '15px 22px', borderTop: '0.5px solid var(--border-md)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
