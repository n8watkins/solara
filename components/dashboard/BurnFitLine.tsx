import { ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { BurnFit } from '@solara/core/sun-safety'
import { burnFitText } from '@solara/core/sunscreen'
import { useUnits } from '@/lib/use-units'
import { timeRange } from '@/lib/time'

const LOOK = {
  fits: { Icon: ShieldCheck, text: 'text-ink-2', icon: 'text-success' },
  sunscreen: { Icon: ShieldAlert, text: 'text-notice-ink', icon: '' },
  'too-long': { Icon: TriangleAlert, text: 'text-notice-ink', icon: '' },
} as const

/**
 * Whether a planned activity fits the burn time, and what makes it fit (ROADMAP item 55,
 * burnFit in @solara/core/sun-safety): the activity card's recommended slot (or the card
 * itself) and the hero. `move` is where an activity too long even with sunscreen fits.
 */
export default function BurnFitLine({
  fit,
  move = null,
  className = '',
}: {
  fit: BurnFit
  move?: { from: number; to: number } | null
  className?: string
}) {
  const fmt = useUnits()
  const { Icon, text, icon } = LOOK[fit.verdict]
  const words = burnFitText(fit, move && timeRange(fmt.time(move.from), fmt.time(move.to)))
  return (
    <p
      data-testid="burn-fit"
      data-verdict={fit.verdict}
      className={`flex items-start gap-1.5 text-[12px] leading-[1.4] font-medium ${text} ${className}`}
    >
      <Icon size={14} aria-hidden="true" className={`mt-px shrink-0 ${icon}`} />
      {/* A time range ("5pm–5:45pm") never breaks at its dash. */}
      <span className="min-w-0">
        {words.split(/(\S+–\S+)/).map((part, i) =>
          i % 2 ? (
            <span key={i} className="whitespace-nowrap">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
    </p>
  )
}
