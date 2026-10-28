import { formatUV } from '@solara/core'
import { Bell, CloudSun, X } from 'lucide-react'
import type { ActivityDayPlan } from '@/lib/next-slot'
import type { UpcomingSlot } from '@/lib/planner'
import { dayPhrase as phraseForDay } from '@/lib/dashboard-view'
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
  next,
  laterDaysVisible,
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
  /** Once today's windows have passed: the soonest slot on a later visible day. */
  next: UpcomingSlot | null
  /** The plan shows days after today (false on the guest plan, which shows today only). */
  laterDaysVisible: boolean
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
              {activity.name} · {slot.windowLabel} · Peak UV {formatUV(slot.peakUV)}
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
              <Bell size={15} />
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
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    )
  }
  // The briefing above names the day's peak, so this card only says what to do:
  // once today is over (the label says so), what comes next.
  const title = !allElapsed
    ? 'UV stays above your limits'
    : next
      ? `Next: ${next.activity.name} ${phraseForDay(false, next.label)} at ${fmt.time(next.slot.start)}`
      : laterDaysVisible
        ? 'No later forecast day has one either'
        : 'Done for today'
  const body = allElapsed ? null : 'Check early morning or evening instead.'
  return (
    <div
      className="card border-[0.5px] border-line-strong bg-surface-metric"
      data-testid="hero-empty"
    >
      <p className="section-label">
        {allElapsed ? 'No lower-UV slot left today' : `No matching lower-UV slot ${dayPhrase}`}
      </p>
      <div className="mt-[9px] flex items-center gap-3.5">
        <CloudSun size={30} strokeWidth={1.75} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <p className="text-[18px] leading-[1.15] font-bold text-ink">{title}</p>
          {body && <p className="mt-[3px] text-[13px] leading-[1.4] text-ink-3">{body}</p>}
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
