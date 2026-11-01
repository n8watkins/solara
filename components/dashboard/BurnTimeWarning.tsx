import { TriangleAlert } from 'lucide-react'
import m from '@/messages/activities'

/**
 * Said wherever a window is offered for an activity that lasts longer than the skin's burn
 * time at its UV limit without sunscreen (outlastsBurnTime in @solara/core/recommendation,
 * REVIEW10 QA M3): the activity card's recommended slot (or the card itself) and the hero.
 */
export default function BurnTimeWarning({ className = '' }: { className?: string }) {
  return (
    <p
      data-testid="burn-time-warning"
      className={`flex items-start gap-1.5 text-[12px] leading-[1.4] font-medium text-notice-ink ${className}`}
    >
      <TriangleAlert size={14} aria-hidden="true" className="mt-px shrink-0" />
      <span>{m.outlastsBurn}</span>
    </p>
  )
}
