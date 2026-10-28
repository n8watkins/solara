import type { ReactNode } from 'react'
import type { SkinType } from '@/lib/types'
import Tooltip from '../Tooltip'

function Metric({
  label,
  help,
  minutes,
  empty,
  detail,
  testId,
}: {
  label: string
  help: string
  /** The estimate in minutes, or null when the UV is too low for one. */
  minutes: number | null
  /** What the card says instead of a number ("No burn risk"). */
  empty: string
  detail: ReactNode
  testId: string
}) {
  return (
    <div className="metric-card px-3 py-2.5" data-testid={testId}>
      <p className="mb-[3px] text-[12px] font-medium text-ink-3">
        <span className="tooltip-anchor">
          {label}
          <Tooltip text={help}>
            <></>
          </Tooltip>
        </span>
      </p>
      {/* The line keeps a number's height either way, so a card with words lines up
          with one showing minutes; the words sit on the number's baseline, sized like
          the dashboard's other words (they used to read "None" at 23 px). */}
      <p className="text-[23px] leading-[1.05] font-bold text-ink">
        {minutes === null ? (
          <span
            className="text-[15px] leading-[1.2] font-semibold text-ink-2"
            data-testid="metric-value"
          >
            {empty}
          </span>
        ) : (
          <>
            <span aria-hidden="true" data-testid="metric-value">
              {minutes}m
            </span>
            <span className="sr-only" data-testid="metric-value-spoken">
              {minutes} minutes
            </span>
          </>
        )}
      </p>
      <p className="mt-[3px] text-[11px] text-ink-3" data-testid="metric-detail">
        {detail}
      </p>
    </div>
  )
}

/** Burn time and vitamin D estimates at the current (or peak) UV. */
export default function ExposureMetrics({
  burn,
  vitD,
  isToday,
  skinType,
  mostSensitive,
  burnFrom,
  vitDFrom,
}: {
  burn: number | null
  vitD: number | null
  isToday: boolean
  skinType: SkinType
  /** In group mode, the name of the person whose skin type is used. */
  mostSensitive?: string
  /** With no burn estimate now: when UV is next high enough for one ("9am tomorrow"). */
  burnFrom: string | null
  /** With no vitamin D estimate now: when UV is next high enough for one. */
  vitDFrom: string | null
}) {
  // In group mode the estimate is the most sensitive person's.
  const whose = mostSensitive
    ? `${mostSensitive}'s ${skinType} skin, the most sensitive in your group,`
    : `${skinType} skin`
  const who = mostSensitive ? `${mostSensitive} (most sensitive)` : `${skinType} skin`
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5"
      data-testid="exposure-metrics"
    >
      <Metric
        testId="burn-metric"
        label="Estimated burn time"
        help={`A rough estimate for ${whose} without sunscreen at this UV level. Do not use it as a timer for unprotected exposure.`}
        minutes={burn}
        empty="No burn risk"
        detail={
          burn || !burnFrom
            ? `${isToday ? 'Now' : 'At peak'} · ${who}, no SPF`
            : `Until ${burnFrom}`
        }
      />
      <Metric
        testId="vitd-metric"
        label="Vitamin D estimate"
        help="A rough model, not a recommended exposure target. Vitamin D needs and production vary widely; ask a clinician if you are concerned."
        minutes={vitD}
        empty="UV too low"
        detail={vitD ? 'Arms + legs' : vitDFrom ? `Until ${vitDFrom}` : 'Needs UV 1 or more'}
      />
    </div>
  )
}
