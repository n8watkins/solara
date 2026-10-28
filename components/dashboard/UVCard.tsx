import { cloudEffect, forecastConfidence } from '@solara/core'
import type { HourlyForecast } from '@/lib/types'
import { dayHourText, uvNumberTone, type SunDown, type UVReadout } from '@/lib/dashboard-view'
import { formatUV, uvLabel } from '@/lib/weather'
import { useUnits } from '@/lib/use-units'
import SunArc from '../SunArc'
import Tooltip from '../Tooltip'
import UVTimeline from '../UVTimeline'
import { ForecastNotes } from '../deferred'
import { UV_NUMBER_TEXT } from './uv-classes'

/**
 * "UV by hour": the focused hour's readout above the sun path and the hourly
 * strip, which share one focus so a tap or scrub on either moves both.
 */
export default function UVCard({
  hourly,
  readout,
  currentHour,
  nowHour,
  focused,
  sunDown,
  daysAhead,
  onSelectHour,
  showSunPath,
  cloudToldAbove = false,
}: {
  hourly: HourlyForecast[]
  readout: UVReadout
  /** The current whole hour on today; -1 on another day. */
  currentHour: number
  /** Fractional "now" for the sun marker on today; null on another day. */
  nowHour: number | null
  focused: HourlyForecast | null
  /** Today before sunrise or after sunset; null in daylight and on other days. */
  sunDown: SunDown | null
  /** How far ahead the shown day is (0 = today), for the forecast confidence. */
  daysAhead: number
  onSelectHour: (h: HourlyForecast) => void
  showSunPath: boolean
  /** The briefing above already says what the clouds take off this day: say it once. */
  cloudToldAbove?: boolean
}) {
  const fmt = useUnits()
  const { headUV, headTemp, headCond, headSuffix, headBurn } = readout
  const cloud = cloudToldAbove ? null : cloudEffect(hourly)
  const confidence = forecastConfidence(daysAhead)
  return (
    <div className="card">
      <p className="mb-3 text-[16px] font-[650] text-ink">
        <Tooltip text="Each bar shows the UV index for that hour. Hover or tap to see burn time and conditions.">
          UV by hour
        </Tooltip>
      </p>

      {/* The one readout for the focused hour. It sits above the arc and strip so a
          finger scrubbing below never covers it, and keeps a fixed two-row layout:
          a long label ("Very high") never moves the temperature or changes the
          card's height as the focus moves. */}
      <div data-testid="uv-readout" className="mb-3.5">
        {sunDown && !focused ? (
          <>
            <p className="flex min-h-10 items-center text-[28px] leading-none font-bold text-ink-2">
              {sunDown.phase === 'after-sunset' ? 'Sun is down' : 'Before sunrise'}
            </p>
            <p className="mt-1.5 min-h-[18px] truncate text-[13.5px] leading-[1.3] text-ink-3">
              {[
                sunDown.uvReturns
                  ? `UV returns about ${dayHourText(sunDown.uvReturns, fmt.hour)}`
                  : `UV ${formatUV(headUV)}`,
                headTemp === undefined ? null : fmt.temp(headTemp),
                headCond || null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </>
        ) : (
          <>
            <div className="flex min-h-10 items-baseline gap-2.5">
              <span
                className={`shrink-0 text-[40px] leading-none font-bold ${UV_NUMBER_TEXT[uvNumberTone(headUV)]}`}
              >
                {formatUV(headUV)}
              </span>
              <span className="min-w-0 text-[14px] leading-[1.2] font-semibold text-ink-2">
                {uvLabel(headUV)}
                <span className="font-medium text-ink-3">{headSuffix}</span>
              </span>
            </div>
            <p className="mt-1.5 min-h-[18px] truncate text-[13.5px] leading-[1.3] text-ink-3">
              {headTemp === undefined ? '--' : fmt.temp(headTemp)} · {headCond}
              {headBurn ? ` · burn ~${headBurn}m` : ''}
            </p>
          </>
        )}
      </div>

      {/* The sun path renders inside the strip's scroller so each hour on the arc
          sits exactly above its bar at every width, and scrolls with it on phones. */}
      <UVTimeline
        hourly={hourly}
        currentHour={currentHour}
        focused={focused}
        onSelectHour={onSelectHour}
        restAtStart={sunDown?.phase === 'after-sunset'}
        above={
          showSunPath ? (
            <SunArc
              hourly={hourly}
              nowHour={nowHour}
              focused={focused}
              onSelectHour={onSelectHour}
              sunDown={sunDown?.phase ?? null}
            />
          ) : null
        }
      />
      {/* Only on a cloudy or far-off day; the wording loads with it (deferred.tsx). */}
      {(cloud || confidence !== 'high') && <ForecastNotes cloud={cloud} confidence={confidence} />}
    </div>
  )
}
