import { ChevronDown, Droplets } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDuration } from '@solara/core/duration'
import { REAPPLY_MINUTES } from '@solara/core/reapply-interval'
import m from '@/messages/activities'

/**
 * The idle sunscreen timer card (ReapplyTimer.tsx), and its placeholder while the timer
 * loads (`placeholder`, components/deferred.tsx): the same layout and the same words, so
 * the placeholder is exactly as tall as the card in every language and at every width,
 * and nothing below moves when the card appears. The placeholder is invisible and hidden
 * from assistive technology; it stands in for the Start button and the closed "How much
 * sunscreen?" disclosure with the same text.
 */
export default function ReapplyTimerIdle({
  titleId,
  start,
  guide,
}: {
  titleId?: string
  /** The Start button; the placeholder shows its text only. */
  start?: ReactNode
  /** The sunscreen guide (SunscreenGuide); the placeholder shows its closed summary. */
  guide?: ReactNode
}) {
  const placeholder = !start
  return (
    <section
      aria-labelledby={placeholder ? undefined : titleId}
      aria-hidden={placeholder || undefined}
      data-testid={placeholder ? 'sunscreen-timer-space' : undefined}
      className={`metric-card flex min-h-24 flex-col justify-center gap-2 px-3 py-2.5 md:min-h-20${placeholder ? ' invisible' : ''}`}
    >
      <div className="flex items-center gap-3">
        <Droplets size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          {placeholder ? (
            <p className="text-[13px] leading-[1.2] font-bold">{m.sunscreenTimer}</p>
          ) : (
            <h2 id={titleId} className="text-[13px] leading-[1.2] font-bold text-ink">
              {m.sunscreenTimer}
            </h2>
          )}
          <p className="mt-0.5 text-[12px] leading-[1.35] text-ink-3">
            {m.headingOut(formatDuration(REAPPLY_MINUTES.standard))}
          </p>
        </div>
        {start ?? <span className="btn btn-primary shrink-0">{m.start}</span>}
      </div>
      <div className="pl-8">
        {guide ?? (
          // As SunscreenGuide's closed <details> and its <summary>.
          <div className="text-[12px] leading-[1.45]">
            <span className="inline-flex items-center gap-1 font-semibold">
              {m.howMuchSunscreen}
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
