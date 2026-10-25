import type { ActivityDayPlan } from '@/lib/next-slot'
import type { UpcomingSlot } from '@/lib/planner'
import { dayPhrase as phraseForDay, type DayOutlook } from '@/lib/dashboard-view'
import { useUnits } from '@/lib/use-units'
import { useUpsellDismissal } from '@/lib/upsell'

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
  next,
  laterDaysVisible,
  night,
  onPlanTomorrow,
  onMorningAlert,
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
  /** Once today's windows have passed: the soonest slot on a later visible day. */
  next: UpcomingSlot | null
  /** The plan shows days after today (false on the guest plan, which shows today only). */
  laterDaysVisible: boolean
  /**
   * After sunset with nothing left today: tomorrow's outlook when the plan shows
   * tomorrow, else null; undefined in daylight.
   */
  night?: DayOutlook | null
  /** Opens the plans dialog, offered when later days are not part of the plan. */
  onPlanTomorrow: () => void
  /** Offers this slot as a morning alert (Pro); absent when the plan has alerts. */
  onMorningAlert?: () => void
}) {
  const fmt = useUnits()
  const [alertDismissed, dismissAlert] = useUpsellDismissal('morning-alert')
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
        {onMorningAlert && !alertDismissed && (
          <div
            role="status"
            className="mt-3 -mb-1 flex items-center justify-between gap-2 border-t-[0.5px] border-brand/20 pt-2"
          >
            <button
              type="button"
              onClick={onMorningAlert}
              className="-ml-1 flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-left text-[13px] font-semibold text-accent"
            >
              <span aria-hidden="true">🔔</span>
              Get this as a morning alert
              <span className="rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-extrabold tracking-[0.05em] uppercase">
                Pro
              </span>
            </button>
            <button
              type="button"
              onClick={dismissAlert}
              aria-label="Not now: morning alerts"
              title="Not now"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[17px] text-ink-3"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
    )
  }
  const passed = "Today's matching windows have passed."
  const nextText = next
    ? `Next: ${next.activity.name} ${phraseForDay(false, next.label)} at ${fmt.time(next.slot.start)}.`
    : null
  const tomorrowText =
    night &&
    `Tomorrow peaks ${night.peakUV.toFixed(1)} at ${fmt.hour(night.peakHour)}${
      night.lowUntil !== null ? `, below UV 3 until ${fmt.hour(night.lowUntil)}` : ''
    }.`
  const body = !allElapsed
    ? 'Forecast UV stays above your activity limits. Check early morning or evening instead.'
    : night !== undefined
      ? [tomorrowText, nextText].filter(Boolean).join(' ') || passed
      : nextText
        ? `${passed} ${nextText}`
        : laterDaysVisible
          ? "Today's matching windows have passed, and none of your other forecast days has one."
          : passed
  return (
    <div
      className="card border-[0.5px] border-line-strong bg-surface-metric"
      data-testid="hero-empty"
    >
      <p className="section-label">
        {allElapsed ? 'No lower-UV slot left today' : `No matching lower-UV slot ${dayPhrase}`}
      </p>
      <div className="mt-[9px] flex items-center gap-3.5">
        <span className="shrink-0 text-[30px]">{night !== undefined ? '🌙' : '🌥️'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] leading-[1.15] font-bold text-ink">
            {night !== undefined
              ? 'Sun is down'
              : `Peak UV ${peakUV.toFixed(1)} at ${fmt.hour(peakHour)}`}
          </p>
          <p className="mt-[3px] text-[13px] leading-[1.4] text-ink-3">{body}</p>
          {allElapsed && !laterDaysVisible && (
            <button
              type="button"
              onClick={onPlanTomorrow}
              className="mt-1 -ml-1 flex min-h-8 items-center rounded-lg px-1 text-left text-[13px] font-semibold text-accent"
            >
              Sign in free to plan tomorrow
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
