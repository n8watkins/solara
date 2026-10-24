import type { ActivityDayPlan } from '@/lib/next-slot'
import { useUnits } from '@/lib/use-units'

/**
 * The dashboard's lead: the selected day's best window, or a clear "no
 * lower-UV slot" headline when UV stays too high, so a phone user gets the
 * actionable answer before any of the detail cards.
 */
export default function HeroSlot({
  plan,
  isToday,
  dateLabel,
  allElapsed,
  dayPhrase,
  peakUV,
  peakHour,
}: {
  /** The soonest plan with a slot, or null when no activity has one. */
  plan: ActivityDayPlan | null
  isToday: boolean
  dateLabel: string
  /** Today had matching windows, but every one has passed. */
  allElapsed: boolean
  dayPhrase: string
  peakUV: number
  peakHour: number
}) {
  const fmt = useUnits()
  if (plan?.slot) {
    const { activity, slot } = plan
    return (
      <div
        className="card border-[0.5px] border-brand/30 bg-transparent bg-[linear-gradient(180deg,rgba(249,115,22,0.10),rgba(249,115,22,0.04))]"
        data-testid="hero-slot"
        data-activity={activity.id}
        data-start={slot.start}
        data-end={slot.end}
      >
        <p className="section-label text-accent">
          {isToday ? 'Next lower-UV slot' : `Lower-UV slot · ${dateLabel}`}
        </p>
        <div className="mt-[9px] flex items-center gap-3.5">
          <span className="shrink-0 text-[32px]">{activity.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[24px] leading-[1.1] font-[750] text-ink">
              {fmt.time(slot.start)}–{fmt.time(slot.end)}
            </p>
            <p className="mt-[3px] truncate text-[13px] text-ink-2">
              {activity.name} · {slot.windowLabel} · Peak UV {slot.peakUV.toFixed(1)}
            </p>
          </div>
          {plan.startsNow && <span className="badge badge-safe shrink-0">Start now</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="card border-[0.5px] border-line-strong bg-surface-metric">
      <p className="section-label">
        {allElapsed ? 'No lower-UV slot left today' : `No matching lower-UV slot ${dayPhrase}`}
      </p>
      <div className="mt-[9px] flex items-center gap-3.5">
        <span className="shrink-0 text-[30px]">🌥️</span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] leading-[1.15] font-bold text-ink">
            Peak UV {peakUV.toFixed(1)} at {fmt.hour(peakHour)}
          </p>
          <p className="mt-[3px] text-[13px] leading-[1.4] text-ink-3">
            {allElapsed
              ? "Today's matching windows have passed. See the best day this week below."
              : 'Forecast UV stays above your activity limits. Check early morning or evening instead.'}
          </p>
        </div>
      </div>
    </div>
  )
}
