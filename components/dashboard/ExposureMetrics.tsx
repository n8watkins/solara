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

/** Burn time and vitamin D estimates at the current (or peak) UV, with the caveat. */
export default function ExposureMetrics({
  burn,
  vitD,
  isToday,
  skinType,
}: {
  burn: number | null
  vitD: number | null
  isToday: boolean
  skinType: SkinType
}) {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
        <Metric
          testId="burn-metric"
          label="Estimated burn time"
          help={`A rough estimate for ${skinType} skin without sunscreen at this UV level. Do not use it as a timer for unprotected exposure.`}
          value={burn ? `${burn}m` : '--'}
          detail={`${isToday ? 'Now' : 'At peak'} · ${skinType} skin, no SPF`}
        />
        <Metric
          label="Vitamin D estimate"
          help="A rough model, not a recommended exposure target. Vitamin D needs and production vary widely; ask a clinician if you are concerned."
          value={vitD ? `${vitD}m` : '--'}
          detail="Arms + legs"
        />
      </div>
      <p className="mx-0.5 -mt-1.5 text-[11px] leading-normal text-ink-3">
        Forecasts and exposure estimates can change. Use sun protection and do not treat these
        planning estimates as medical advice.
      </p>
    </>
  )
}
