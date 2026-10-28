import { formatUV } from '@solara/core'
import { Fragment } from 'react'
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
  hoursInDark = false,
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
  /** Every activity's preferred hours fall in the dark on this day (ActivityDayPlan.hoursInDark). */
  hoursInDark?: boolean
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
        {/* "Start now" rides on the label's row, so the time keeps the card's full width
            and stays on one line from 320 px; the detail line wraps between its parts
            rather than cutting any of them off. */}
        <div className="flex min-h-[18px] items-center justify-between gap-2">
          <p className="section-label text-accent">
            {isToday ? 'Next lower-UV slot' : `Lower-UV slot · ${dateLabel}`}
          </p>
          {plan.startsNow && <span className="badge badge-safe shrink-0">Start now</span>}
        </div>
        <div className="mt-2 flex items-center gap-3.5">
          <span className="shrink-0 text-[32px]" aria-hidden="true">
            {activity.icon}
          </span>
          <div className="min-w-0 flex-1">
            <p
              data-testid="hero-time"
              className="text-[24px] leading-[1.1] font-[750] whitespace-nowrap text-ink"
            >
              {fmt.time(slot.start)}–{fmt.time(slot.end)}
            </p>
            <p data-testid="hero-detail" className="mt-[3px] text-[13px] leading-[1.35] text-ink-2">
              {/* Each part stays whole; a line can break only after a dot. */}
              {[activity.name, slot.windowLabel, `Peak UV ${formatUV(slot.peakUV)}`].map(
                (part, i) => (
                  <Fragment key={i}>
                    {i > 0 && '\u00a0· '}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ),
              )}
            </p>
          </div>
        </div>
        {onMorningAlert && !alertDismissed && (
          <div
            role="status"
            className="mt-3 -mb-1 flex items-center justify-between gap-2 border-t-[0.5px] border-brand/20 pt-2"
          >
            <button
              type="button"
              onClick={onMorningAlert}
              className="-ml-1 flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-left text-[13px] leading-[1.35] font-semibold text-accent"
            >
              <Bell size={15} className="shrink-0" />
              {/* One run of text, so on a narrow phone it wraps with "Pro" beside the
                  last word instead of leaving the badge stranded on its own. */}
              <span>
                Get this as a morning{' '}
                <span className="whitespace-nowrap">
                  alert{' '}
                  <span className="ml-0.5 inline-block rounded-full bg-accent-soft px-1.5 py-px align-[1px] text-[10px] leading-[1.4] font-extrabold tracking-[0.05em] uppercase">
                    Pro
                  </span>
                </span>
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
    ? hoursInDark
      ? 'No daylight in your hours'
      : 'UV stays above your limits'
    : next
      ? `Next: ${next.activity.name} ${phraseForDay(false, next.label)} at ${fmt.time(next.slot.start)}`
      : laterDaysVisible
        ? 'No later forecast day has one either'
        : 'Done for today'
  // Solara plans outdoor time in daylight only, so hours before sunrise or after sunset
  // never get a slot, however low their UV.
  const body = allElapsed
    ? null
    : hoursInDark
      ? 'Solara plans between sunrise and sunset. Move the hours to get a slot.'
      : 'Check early morning or evening instead.'
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
