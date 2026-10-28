import { Clock, Share2, ShieldCheck, Sun, Timer, type LucideIcon } from 'lucide-react'
import type * as ShareCode from '@/lib/share'
import { useStatusFlash } from '@/hooks/useStatusFlash'
import type { DailyBriefingView } from '@/lib/briefing-view'

/**
 * "Today at a glance": the day's peak UV, the best lower-UV window for the plan,
 * the burn time at the peak and one line of advice, from the shared briefing in
 * @solara/core. After dark it briefs tomorrow, so it leads the dashboard at night.
 */
export default function DailyBriefing({
  view,
  onSignIn,
}: {
  view: DailyBriefingView
  /** Opens the plans dialog; offered when the briefed day is beyond the plan. */
  onSignIn: () => void
}) {
  const status = useStatusFlash(4500)
  const { heading, briefing, locked, shareTitle, shareText } = view

  async function share() {
    // The share code loads in the background soon after the page loads
    // (components/deferred.tsx), so the share sheet still opens within the tap.
    let code: typeof ShareCode
    try {
      code = await import('@/lib/share')
    } catch {
      status.flash('Could not share. Check your connection and try again.')
      return
    }
    let result: Awaited<ReturnType<typeof code.shareOrCopy>>
    try {
      result = await code.shareOrCopy(shareTitle, shareText, `${window.location.origin}/app/`)
    } catch {
      // AbortError: the share sheet was dismissed.
      return
    }
    status.flash(
      result === 'shared'
        ? 'Shared the briefing.'
        : result === 'copied'
          ? 'Copied the briefing and link.'
          : 'Sharing is not supported here.',
    )
  }

  const rows: { icon: LucideIcon; text: string | null; id: string }[] = locked
    ? []
    : [
        { id: 'peak', icon: Sun, text: briefing.lines.peak },
        { id: 'window', icon: Clock, text: briefing.lines.window },
        { id: 'burn', icon: Timer, text: briefing.lines.burn },
        { id: 'tip', icon: ShieldCheck, text: briefing.lines.tip },
      ]

  return (
    <section
      className="card py-3.5"
      aria-labelledby="briefing-heading"
      data-testid="daily-briefing"
      data-day={briefing.date}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id="briefing-heading" className="section-label">
          {heading}
        </h2>
        {!locked && (
          <button
            type="button"
            onClick={() => void share()}
            className="-mr-1.5 flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold text-accent"
          >
            <Share2 size={15} aria-hidden />
            Share
          </button>
        )}
      </div>
      {locked ? (
        <div className="mt-1">
          <p className="text-[14px] leading-[1.45] text-ink-2">
            Tomorrow&apos;s peak UV, best window and burn time come with a free account.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            className="mt-1 -ml-1 flex min-h-8 items-center rounded-lg px-1 text-left text-[13px] font-semibold text-accent"
          >
            Sign in free to plan tomorrow
          </button>
        </div>
      ) : (
        <ul className="mt-1.5 grid gap-x-6 gap-y-2 md:grid-cols-2">
          {rows.map(({ id, icon: Icon, text }) =>
            text ? (
              <li
                key={id}
                data-line={id}
                className="flex items-start gap-2.5 text-[14px] leading-[1.4] text-ink-2"
              >
                <Icon size={17} aria-hidden className="mt-px shrink-0 text-accent" />
                <span className="min-w-0">{text}</span>
              </li>
            ) : null,
          )}
        </ul>
      )}
      {status.message && (
        <p role="status" className="mt-2 text-[12px] text-accent">
          {status.message}
        </p>
      )}
    </section>
  )
}
