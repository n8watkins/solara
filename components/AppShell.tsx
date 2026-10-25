'use client'
import { CalendarDays, Sun, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import clsx from 'clsx'

export type AppView = 'dashboard' | 'calendar'

const VIEWS: { id: AppView; label: string; heading: string; Icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', heading: 'UV dashboard', Icon: Sun },
  { id: 'calendar', label: 'Calendar', heading: 'Activity calendar', Icon: CalendarDays },
]

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
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-40">
        {header}
        {onViewChange && (
          <div className="border-b-[0.5px] border-line-strong bg-surface-card">
            <div className="mx-auto flex max-w-[900px] px-4 lg:max-w-[1240px]">
              {VIEWS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => onViewChange(id)}
                  aria-current={view === id ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-1.5 border-b-2 px-4 py-[11px] text-[13px] font-medium capitalize transition-colors duration-150',
                    view === id ? 'border-accent text-accent' : 'border-transparent text-ink-3',
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <main className="mx-auto max-w-[900px] px-4 py-6 lg:max-w-[1240px]">
        {/* The page's one h1 names the view for assistive tech; the header and the
            active tab already say where you are visually, so it is not drawn. */}
        <h1 className="sr-only">{VIEWS.find(v => v.id === view)?.heading}</h1>
        {children}
      </main>
      {after}
    </div>
  )
}
