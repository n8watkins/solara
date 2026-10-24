import type { ReactNode } from 'react'

/** Text for screen readers only (kept in the accessible name, not drawn). */
export default function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  )
}
