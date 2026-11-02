import { formatUV } from '@solara/core'
import { formatDuration } from '@solara/core/duration'
import { exposureSummary } from '@/lib/activity-exposure'
import { NotebookPen, Pencil } from 'lucide-react'
import type { SafeActivityWindow } from '@/lib/types'
import type { ActivityDayPlan } from '@solara/core/next-slot'
import type { ScheduledActivity, ScheduledSpan } from '@/lib/scheduled'
import { recommendSlot, type SlotRecommendation } from '@solara/core/scheduler'
import { effectiveMaxUV } from '@solara/core/tiers'
import { PROTECT_FROM_UV } from '@solara/core/protection'
import {
  activityBodyAreas,
  sunscreenAmount,
  sunscreenAmountShort,
  type BodyArea,
} from '@solara/core/sunscreen'
import { fmtDays } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import {
  activityBadge,
  bestWindowLabel,
  isRecommendationScheduled,
  matchTone,
} from '@/lib/activity-card-view'
import { formatActivityDuration } from '@/lib/activity-presets'
import BurnFitLine from './BurnFitLine'
import RecommendedSlot from './RecommendedSlot'
import ScheduledCardRow from './ScheduledCardRow'
import WeatherNote from './WeatherNote'
import WindowRow from './WindowRow'
import { timeRange } from '@/lib/time'
import m from '@/messages/activities'

const MATCH_BAR = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const

function Stat({ label, val, tone }: { label: string; val: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      {/* The label keeps up to half the row, so a short one ("Protector solar") stays on one
          line and a long one ("Tiempo hasta quemarte con UV 4") wraps rather than pushing its
          value past the card's edge at 320 px; the value wraps in the rest. */}
      <span className="max-w-[50%] shrink-0 text-ink-3">{label}</span>
      <span className={`min-w-0 text-right font-medium ${color}`}>{val}</span>
    </div>
  )
}

/** One activity's plan for the selected day. */
export default function ActivityCard({
  plan,
  isToday,
  scheduled,
  calendarHref,
  onBook,
  onShare,
  onEdit,
  onOpenScheduled,
  onLog,
  passedNote,
}: {
  plan: ActivityDayPlan
  isToday: boolean
  scheduled: { item: ScheduledActivity; span: ScheduledSpan }[]
  /** A prefilled Google Calendar link for a span; absent when the tier has no calendar. */
  calendarHref?: (span: { from: number; to: number }) => string
  /** Books a slot as a real event (calendar connected and allowed). */
  onBook?: (rec: SlotRecommendation) => void
  onShare: (win: SafeActivityWindow) => void
  onEdit?: () => void
  onOpenScheduled?: (item: ScheduledActivity) => void
  /**
   * Logs the activity in the vitamin D log once today's windows have passed ("Log it"),
   * with the parts it usually leaves in the sun.
   */
  onLog?: (areas: readonly BodyArea[]) => void
  /** What comes next once today's windows have passed (see windowsPassedNote). */
  passedNote?: string
}) {
  const fmt = useUnits()
  const { activity, bestWindow, windows, slot: rec, pctDaySafe, burnMins, fit, fitMove } = plan
  const badge = activityBadge(plan, isToday)
  const bestLabel = bestWindowLabel(plan, isToday, fmt.time)
  const safeUv = effectiveMaxUV(activity)
  const days = fmtDays(activity.daysOfWeek)
  const exposure = exposureSummary(activity)
  // How much sunscreen the parts this activity usually bares take, where its windows
  // reach the UV that calls for protection or its slot needs sunscreen to fit the burn
  // time (packages/core/src/sunscreen.ts, sun-safety.ts).
  const sunscreen =
    safeUv >= PROTECT_FROM_UV || (fit && fit.verdict !== 'fits')
      ? sunscreenAmountShort(sunscreenAmount(activityBodyAreas(activity.id)))
      : null
  // Once the recommended slot is on the calendar, the Scheduled row replaces it.
  const recScheduled = isRecommendationScheduled(rec, scheduled)

  return (
    <div
      className="card flex flex-col gap-2.5"
      data-testid="activity-card"
      data-activity={activity.id}
    >
      <div className="flex items-center gap-2">
        <span className="text-[18px]">{activity.icon}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{activity.name}</span>
        <span className={`badge badge-${badge.status} shrink-0`}>{badge.label}</span>
        {onEdit && (
          <button
            className="btn btn-ghost ml-auto shrink-0 px-2 py-1 text-[13px]"
            onClick={onEdit}
            aria-label={m.editNamed(activity.name)}
            title={m.editActivity}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>

      {scheduled.map(({ item, span }) => (
        <ScheduledCardRow
          key={item.eventId}
          item={item}
          span={span}
          activityName={activity.name}
          onManage={onOpenScheduled}
        />
      ))}

      {rec && !recScheduled && (
        <RecommendedSlot
          rec={rec}
          fit={fit}
          fitMove={fitMove}
          onBook={onBook && (() => onBook(rec))}
          calendarHref={calendarHref?.({ from: rec.start, to: rec.end })}
        />
      )}

      {/* Whether it fits the burn time, and what makes it fit (ROADMAP item 56): in the
          recommended slot, or here when the slot is on the calendar or there is none. */}
      {fit && !(rec && !recScheduled) && <BurnFitLine fit={fit} move={fitMove} />}

      <div className="flex flex-col gap-[5px]">
        <Stat
          label={m.plannedForLabel}
          val={activity.sunscreen ? m.plannedForSpf(safeUv) : m.plannedFor(safeUv)}
        />
        <Stat label={m.duration} val={formatActivityDuration(activity.durationMins)} />
        {activity.preferredHours && (
          <Stat
            label={m.preferred}
            val={timeRange(
              fmt.hour(activity.preferredHours.from),
              fmt.hour(activity.preferredHours.to),
            )}
          />
        )}
        {days && <Stat label={m.days} val={days} />}
        {exposure && <Stat label={m.setting} val={exposure} />}
        {/* With a fit, the burn time it is judged by (the slot's UV), so the card never
            shows two burn times; else the burn time at the UV limit. */}
        {fit
          ? fit.burnMins !== null && (
              <Stat
                label={m.burnTimeAt(formatUV(fit.uv))}
                val={m.aboutDuration(formatDuration(fit.burnMins))}
              />
            )
          : burnMins !== null &&
            burnMins !== undefined && (
              <Stat
                label={m.burnTimeAt(String(safeUv))}
                val={m.aboutDuration(formatDuration(burnMins))}
              />
            )}
        {sunscreen && <Stat label={m.sunscreen} val={sunscreen} />}
        {bestLabel !== null && (
          <Stat label={m.bestWindow} val={bestLabel} tone={bestWindow ? 'success' : 'danger'} />
        )}
      </div>

      <div>
        <div className="h-1 overflow-hidden rounded-[2px] bg-line-strong">
          <div
            className={`h-full rounded-[2px] ${MATCH_BAR[matchTone(pctDaySafe)]}`}
            style={{ width: `${pctDaySafe}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink-3">{m.daylightFit(pctDaySafe)}</p>
      </div>

      {plan.elapsed ? (
        // The badge already says today is done; this names what comes next, after the
        // rain or heat that took what was left of today.
        <div className="flex flex-col gap-1.5">
          <WeatherNote spans={plan.weather} />
          {passedNote && <p className="text-[12px] leading-[1.45] text-ink-3">{passedNote}</p>}
          {isToday && onLog && (
            <button
              type="button"
              className="btn self-start px-2.5 py-1 text-[12px]"
              aria-haspopup="dialog"
              aria-label={m.logItNamed(activity.name)}
              data-testid="vitd-log-it"
              onClick={() => onLog(activityBodyAreas(activity.id))}
            >
              <NotebookPen size={13} aria-hidden="true" />
              {m.logIt}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[7px]">
          <p className="text-[11px] font-bold tracking-[0.055em] text-ink-3 uppercase">
            {isToday ? m.windowsLeftToday : m.windowsEstimated}
          </p>
          {windows.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {/* What the weather took from the windows below, so a gap reads as rain or
                  heat, not as UV. */}
              <WeatherNote spans={plan.weather} className="mb-0.5" />
              {windows.map((win, i) => (
                <WindowRow
                  key={`${win.from}-${win.to}`}
                  win={win}
                  isBest={!!bestWindow && win.from === bestWindow.from && win.to === bestWindow.to}
                  cloudNote={!!plan.cloudDependent[i]}
                  onShare={() => onShare(win)}
                  calendarHref={calendarHref?.(win)}
                  onSchedule={
                    onBook &&
                    (() => {
                      const slot = recommendSlot(
                        [win],
                        [],
                        activity.durationMins,
                        activity.timePreference ?? 'earliest',
                      )
                      if (slot) onBook(slot)
                    })
                  }
                />
              ))}
            </div>
          ) : plan.weather.length > 0 ? (
            <>
              <WeatherNote spans={plan.weather} />
              <p className="text-[12px] leading-[1.45] text-ink-3">
                {(plan.weather.some(s => s.kind === 'rain') ? m.noWindowRain : m.noWindowHeat)(
                  isToday,
                )}
              </p>
            </>
          ) : (
            <p className="text-[12px] leading-[1.45] text-ink-3">{m.noWindowMatches(isToday)}</p>
          )}
        </div>
      )}
    </div>
  )
}
