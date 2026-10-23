'use client'
import type { ReactNode } from 'react'

export type AppView = 'dashboard' | 'calendar'

const VIEWS: { id: AppView; label: string; heading: string }[] = [
  { id: 'dashboard', label: '☀️ Dashboard', heading: 'UV dashboard' },
  { id: 'calendar', label: '🗓️ Calendar', heading: 'Activity calendar' },
]

// The page's one h1 names the view for assistive tech; the header and the active
// tab already say where you are visually, so it is not drawn.
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

interface Props {
  /** The page header (normally `<Header>`), kept sticky together with the view tabs. */
  header: ReactNode
  view: AppView
  /** Shows the Dashboard / Calendar tabs. Omit to hide them. */
  onViewChange?: (view: AppView) => void
  children: ReactNode
  /** Rendered after the main column, outside it (dev panels, modals). */
  after?: ReactNode
}

/**
 * The signed-in app frame: sticky header and view tabs over a centered main
 * column that widens for the calendar. Shared by components/App.tsx and the UI
 * harness so screenshots always show the real layout.
 */
export default function AppShell({ header, view, onViewChange, children, after }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 40 }}>
        {header}
        {onViewChange && (
          <div
            style={{ borderBottom: '0.5px solid var(--border-md)', background: 'var(--bg-card)' }}
          >
            <div
              style={{
                maxWidth: '900px',
                margin: '0 auto',
                padding: '0 1rem',
                display: 'flex',
                gap: '0',
              }}
            >
              {VIEWS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => onViewChange(id)}
                  aria-current={view === id ? 'page' : undefined}
                  style={{
                    padding: '11px 16px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    borderBottom: view === id ? '2px solid var(--accent)' : '2px solid transparent',
                    color: view === id ? 'var(--accent)' : 'var(--text-3)',
                    textTransform: 'capitalize',
                    transition: 'color 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <main
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '1.5rem 1rem',
        }}
      >
        <h1 style={visuallyHidden}>{VIEWS.find(v => v.id === view)?.heading}</h1>
        {children}
      </main>
      {after}
    </div>
  )
}
