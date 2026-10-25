import type { ReactNode } from 'react'
import type { SkinType } from '@/lib/types'
import Tooltip from '../Tooltip'

function Metric({
  label,
  help,
  value,
  detail,
  testId,
}: {
  label: string
  help: string
  value: ReactNode
  detail: ReactNode
  testId?: string
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
      <p className="text-[23px] leading-[1.05] font-bold text-ink">{value}</p>
      <p className="mt-[3px] text-[11px] text-ink-3">{detail}</p>
    </div>
  )
}

/** Burn time and vitamin D estimates at the current (or peak) UV. */
export default function ExposureMetrics({
  burn,
  vitD,
  isToday,
  skinType,
  burnFrom,
  vitDFrom,
}: {
  burn: number | null
  vitD: number | null
  isToday: boolean
  skinType: SkinType
  /** With no burn estimate now: when UV is next high enough for one ("9am tomorrow"). */
  burnFrom: string | null
  /** With no vitamin D estimate now: when UV is next high enough for one. */
  vitDFrom: string | null
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
      <Metric
        testId="burn-metric"
        label="Estimated burn time"
        help={`A rough estimate for ${skinType} skin without sunscreen at this UV level. Do not use it as a timer for unprotected exposure.`}
        value={burn ? `${burn}m` : 'None'}
        detail={
          burn || !burnFrom
            ? `${isToday ? 'Now' : 'At peak'} · ${skinType} skin, no SPF`
            : `No burn risk until ${burnFrom}`
        }
      />
      <Metric
        label="Vitamin D estimate"
        help="A rough model, not a recommended exposure target. Vitamin D needs and production vary widely; ask a clinician if you are concerned."
        value={vitD ? `${vitD}m` : 'None'}
        detail={vitD || !vitDFrom ? 'Arms + legs' : `UV too low until ${vitDFrom}`}
      />
    </div>
  )
}
