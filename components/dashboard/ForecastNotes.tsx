import { Cloud, Gauge } from 'lucide-react'
import { cloudNote, confidenceNote, type CloudEffect, type ForecastConfidence } from '@solara/core'

/** Under the UV card: how much the day's clouds lower UV, and how sure its forecast is. */
export default function ForecastNotes({
  cloud,
  confidence,
}: {
  cloud: CloudEffect | null
  confidence: ForecastConfidence
}) {
  const sureness = confidenceNote(confidence)
  return (
    <ul data-testid="uv-forecast-notes" className="mt-3 grid gap-1.5">
      {cloud && (
        <li className="flex items-start gap-2 text-[13px] leading-[1.4] text-ink-2">
          <Cloud size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          {cloudNote(cloud)}.
        </li>
      )}
      {sureness && (
        <li className="flex items-start gap-2 text-[13px] leading-[1.4] text-ink-2">
          <Gauge size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          {sureness}.
        </li>
      )}
    </ul>
  )
}
