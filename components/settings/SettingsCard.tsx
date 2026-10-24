import clsx from 'clsx'
import type { ComponentProps } from 'react'

// Building blocks shared by the Settings sections.

/** A tinted group of related settings. */
export function SettingsCard({ className, ...props }: ComponentProps<'div'>) {
  return <div className={clsx('metric-card', className)} {...props} />
}

/** The name of a setting or group. */
export function SettingsTitle({ className, ...props }: ComponentProps<'h4'>) {
  return <h4 className={clsx('text-[13px] font-bold text-ink', className)} {...props} />
}

/** Secondary text under a title. */
export function SettingsHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={clsx('text-[13px] text-ink-3', className)} {...props} />
}

/** An inline error message, announced when it appears. */
export function SettingsError({ className, ...props }: ComponentProps<'p'>) {
  return <p role="alert" className={clsx('text-[12px] text-danger', className)} {...props} />
}

/**
 * A label and description beside their control. On phones the control moves
 * under the description instead of squeezing both. `inline` is for a one-line
 * label: centered on the row on wide screens, left-aligned when stacked.
 */
export function SettingsField({
  inline = false,
  className,
  ...props
}: ComponentProps<'div'> & { inline?: boolean }) {
  return (
    <div
      className={clsx(
        'flex justify-between gap-3.5 max-sm:flex-col max-sm:gap-2.5',
        inline ? 'items-center max-sm:items-start' : 'items-start max-sm:items-stretch',
        className,
      )}
      {...props}
    />
  )
}

/** Width for a select or input inside a SettingsField. */
export const FIELD_CONTROL = 'min-w-42.5 text-[14px] max-sm:min-w-0 max-sm:w-full'
