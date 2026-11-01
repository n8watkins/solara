import { ChevronDown } from 'lucide-react'
import { protectionUV } from '@solara/core/protection'
import type { SkinType } from '@solara/core/recommendation'
import {
  BODY_AREAS,
  REAPPLY_RULE,
  TEASPOON_RULE,
  spfAdvice,
  spfAdviceText,
  sunscreenAmount,
  sunscreenAmountText,
} from '@solara/core/sunscreen'
import type { SkyHour } from '@solara/core/forecast-quality'

/** The day's peak UV as protection advice judges it (the clear sky), or null without hours. */
function peakProtectionUV(hours: readonly SkyHour[]): number | null {
  const values = hours.map(protectionUV).filter(Number.isFinite)
  return values.length ? Math.max(...values) : null
}

/**
 * "How much sunscreen?": today's SPF for the skin type, the teaspoon rule and when to
 * reapply (packages/core/src/sunscreen.ts, docs/SUNSCREEN.md). Closed until asked for,
 * so the timer card stays compact.
 */
export default function SunscreenGuide({
  today,
  skinType,
}: {
  /** Today's forecast hours; the SPF line is left out without them. */
  today?: readonly SkyHour[]
  skinType?: SkinType
}) {
  const peak = today && skinType ? peakProtectionUV(today) : null
  const lines = [
    peak !== null && skinType ? spfAdviceText(spfAdvice(peak, skinType), peak, skinType) : null,
    TEASPOON_RULE,
    `${sunscreenAmountText(sunscreenAmount(BODY_AREAS))}.`,
    REAPPLY_RULE,
  ].filter((line): line is string => line !== null)

  return (
    <details className="group text-[12px] leading-[1.45] text-ink-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md font-semibold text-accent [&::-webkit-details-marker]:hidden">
        How much sunscreen?
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <ul className="m-0 mt-1.5 list-disc space-y-1 pl-[18px]">
        {lines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )
}
