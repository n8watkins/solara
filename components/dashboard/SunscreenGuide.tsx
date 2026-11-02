import { ChevronDown } from 'lucide-react'
import { protectionUV } from '@solara/core/protection'
import type { SkinType } from '@solara/core/recommendation'
import {
  BODY_AREAS,
  reapplyRule,
  teaspoonRule,
  spfAdvice,
  spfAdviceText,
  sunscreenAmount,
  sunscreenAmountText,
} from '@solara/core/sunscreen'
import type { SkyHour } from '@solara/core/forecast-quality'
import m from '@/messages/dashboard'
import app from '@/messages/app'

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
  onTint = false,
}: {
  /** Today's forecast hours; the SPF line is left out without them. */
  today?: readonly SkyHour[]
  skinType?: SkinType
  /** On the due card's accent tint, where the plain accent is too faint for small text. */
  onTint?: boolean
}) {
  const peak = today && skinType ? peakProtectionUV(today) : null
  const lines = [
    peak !== null && skinType ? spfAdviceText(spfAdvice(peak, skinType), peak, skinType) : null,
    teaspoonRule(),
    `${sunscreenAmountText(sunscreenAmount(BODY_AREAS))}.`,
    reapplyRule(),
  ].filter((line): line is string => line !== null)

  return (
    <details className="group text-[12px] leading-[1.45] text-ink-2">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-md font-semibold [&::-webkit-details-marker]:hidden ${onTint ? 'text-accent-hover' : 'text-accent'}`}
      >
        {m.howMuchSunscreen}
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
      <p className="mt-1.5 text-ink-3">
        {m.sunscreenNotMedical} {app.healthQualifier}
      </p>
    </details>
  )
}
