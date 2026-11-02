import type { DayTotal } from '@solara/core/vitamin-d-log'
import { roundIu } from '@solara/core/vitamin-d-session'
import { formatNumber } from '@solara/core/i18n'
import { formatDate } from '@/lib/time'
import m from '@/messages/vitamin-d'

/** The bars' scale never drops below this, so one small day does not fill the chart. */
const SCALE_FLOOR_IU = 1000

/** A day's estimate in words: "about 1,200 IU", "under 50 IU", "none". */
export function iuText(iu: number): string {
  const rounded = roundIu(iu)
  if (rounded > 0) return m.aboutIu(formatNumber(rounded))
  return iu > 0 ? m.underFiftyIu : m.noneIu
}

/**
 * The last 7 days' estimates as bars, oldest first, with each day and value on screen and
 * a table for screen readers (the bars are drawn only). No goal line: the log sets none.
 */
export default function WeekChart({ totals, today }: { totals: DayTotal[]; today: string }) {
  const scale = Math.max(SCALE_FLOOR_IU, ...totals.map(total => total.iu))
  return (
    <figure className="m-0" data-testid="vitd-week-chart">
      <figcaption className="mb-2 text-[12px] font-semibold text-ink-2">{m.chartTitle}</figcaption>
      <div aria-hidden="true" className="grid grid-cols-7 gap-1">
        {totals.map(total => (
          <div key={total.date} className="flex min-w-0 flex-col items-center gap-1">
            {/* Two lines tall in every language, so the bars line up: "6.7 mil" wraps
                under its number in a bar this narrow. */}
            <span
              data-testid="vitd-chart-value"
              className="flex h-[22px] items-end text-center text-[10px] leading-[11px] font-semibold text-ink-2 tabular-nums"
            >
              {m.chartValue(roundIu(total.iu))}
            </span>
            <div className="flex h-16 w-full max-w-7 items-end rounded-md bg-surface-metric">
              <div
                className={`w-full rounded-md ${total.date === today ? 'bg-accent' : 'bg-brand/60'}`}
                style={{ height: `${total.iu > 0 ? Math.max(4, (total.iu / scale) * 100) : 0}%` }}
              />
            </div>
            <span
              className={`text-[10px] leading-none ${total.date === today ? 'font-bold text-ink' : 'text-ink-3'}`}
            >
              {formatDate(total.date, { weekday: 'short' })}
            </span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{m.chartTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{m.chartDay}</th>
            <th scope="col">{m.chartEstimate}</th>
            <th scope="col">{m.chartSessions}</th>
          </tr>
        </thead>
        <tbody>
          {totals.map(total => (
            <tr key={total.date}>
              <th scope="row">
                {formatDate(total.date, { weekday: 'long', month: 'long', day: 'numeric' })}
              </th>
              <td>{iuText(total.iu)}</td>
              <td>{formatNumber(total.sessions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
