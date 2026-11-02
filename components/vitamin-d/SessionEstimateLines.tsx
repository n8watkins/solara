import clsx from 'clsx'
import { formatDuration } from '@solara/core/duration'
import { formatNumber } from '@solara/core/i18n'
import { burnRisk, roundIu, type BurnRisk, type SessionEstimate } from '@solara/core/vitamin-d-session'
import m from '@/messages/vitamin-d'

const RISK: Record<BurnRisk, { text: () => string; tone: string; dot: string }> = {
  'well-under': { text: () => m.burnWellUnder, tone: 'text-ink-2', dot: 'bg-ink-3' },
  close: { text: () => m.burnClose, tone: 'text-warning', dot: 'bg-warning' },
  past: { text: () => m.burnPast, tone: 'text-danger', dot: 'bg-danger' },
}

/** A session's estimated vitamin D. */
export function sessionIuText(iu: number): string {
  const rounded = roundIu(iu)
  if (rounded > 0) return m.sessionEstimate(formatNumber(rounded))
  return iu > 0 ? m.sessionEstimateUnder50 : m.sessionEstimateNone
}

/**
 * A session's estimate: its vitamin D, then how close it came to the burn time, in words
 * and minutes, with why time or UV counted for less.
 */
export default function SessionEstimateLines({ estimate }: { estimate: SessionEstimate }) {
  const risk = estimate.burnMinutes === null ? null : RISK[burnRisk(estimate.burnShare)]
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[14px] font-semibold text-ink" data-testid="vitd-session-iu">
        {sessionIuText(estimate.iu)}
      </p>
      <p
        className={clsx(
          'flex items-start gap-1.5 text-[12px] leading-snug font-medium',
          risk?.tone ?? 'text-ink-3',
        )}
        data-testid="vitd-session-burn"
      >
        <span
          aria-hidden="true"
          className={clsx('mt-[5px] size-1.5 shrink-0 rounded-full', risk?.dot ?? 'bg-ink-3')}
        />
        <span>
          {risk && estimate.burnMinutes !== null
            ? m.burnLine(
                risk.text(),
                m.burnOf(formatDuration(estimate.minutes), formatDuration(estimate.burnMinutes)),
              )
            : m.burnNone}
        </span>
      </p>
      {estimate.capped && <p className="text-[12px] leading-snug text-ink-3">{m.cappedNote}</p>}
      {estimate.lowUv && <p className="text-[12px] leading-snug text-ink-3">{m.lowUvNote}</p>}
    </div>
  )
}
