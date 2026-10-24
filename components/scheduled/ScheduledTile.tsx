import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * An activity's icon on its color, with the green check that marks it as scheduled.
 * `small` is the list row size.
 */
export default function ScheduledTile({
  color,
  small,
  children,
}: {
  color: string
  small?: boolean
  children: ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'relative grid shrink-0 place-items-center rounded-[10px]',
        small ? 'size-8 text-[16px]' : 'size-9 text-[18px]',
      )}
      style={{ background: color }}
    >
      {children}
      <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-[#047857] text-[10px] leading-none font-extrabold text-white shadow-[0_0_0_2px_var(--bg-card)]">
        ✓
      </span>
    </span>
  )
}
