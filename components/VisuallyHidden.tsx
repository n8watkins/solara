import type { ReactNode } from 'react'

const style = {
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

/** Text for screen readers only (kept in the accessible name, not drawn). */
export default function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} style={style}>
      {children}
    </span>
  )
}
