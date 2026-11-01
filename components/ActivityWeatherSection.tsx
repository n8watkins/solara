'use client'
import { FEELS_LIKE_CHOICES, RAIN_LIKELY_PERCENT } from '@solara/core/weather-fit'
import { useUnits } from '@/lib/use-units'
import { ActivityEditSection } from './ActivityEditSection'
import m from '@/messages/editor'

const fromFahrenheit = (f: number) => Math.round(((f - 32) * 5 * 10) / 9) / 10
const NO_LIMIT = 'none'

/**
 * "Rain and heat" in the Edit activity form: whether the activity skips hours with
 * likely rain, and the feels-like temperature it stops at (@solara/core weather-fit.ts).
 * Limits are offered in the display unit and stored in Celsius.
 */
export function ActivityWeatherSection({
  id,
  avoidRain,
  maxFeelsLikeC,
  onChange,
}: {
  id: string
  avoidRain: boolean
  maxFeelsLikeC: number | null
  onChange: (patch: { avoidRain?: boolean; maxFeelsLikeC?: number | null }) => void
}) {
  const fmt = useUnits()
  const unit = fmt.units.temperature
  const choices = FEELS_LIKE_CHOICES[unit].map(value =>
    unit === 'fahrenheit' ? fromFahrenheit(value) : value,
  )
  // A limit set in the other unit (or a default) shows as the choice that reads the same,
  // and as its own choice when none does.
  const current =
    maxFeelsLikeC === null
      ? null
      : (choices.find(c => fmt.temp(c) === fmt.temp(maxFeelsLikeC)) ?? maxFeelsLikeC)
  const options = current === null || choices.includes(current) ? choices : [...choices, current]
  const field = 'flex flex-col gap-[5px] text-[12px] text-ink-3'
  return (
    <ActivityEditSection
      id={id}
      title={m.rainAndHeat}
      description={m.rainHeatHint(RAIN_LIKELY_PERCENT)}
    >
      {/* Side by side from 360 px; stacked on the narrowest phones, so no choice is cut off
          under its select's arrow. */}
      <div className="grid gap-2.5 min-[360px]:grid-cols-2">
        <label className={field}>
          {m.rain}
          <select
            value={avoidRain ? 'avoid' : 'ok'}
            onChange={e => onChange({ avoidRain: e.target.value === 'avoid' })}
            aria-describedby={`${id}-desc`}
            className="text-[13px]"
          >
            <option value="avoid">{m.avoid}</option>
            <option value="ok">{m.goAhead}</option>
          </select>
        </label>
        <label className={field}>
          {m.maxFeelsLike}
          <select
            value={current === null ? NO_LIMIT : String(current)}
            onChange={e =>
              onChange({
                maxFeelsLikeC: e.target.value === NO_LIMIT ? null : Number(e.target.value),
              })
            }
            aria-describedby={`${id}-desc`}
            className="text-[13px]"
          >
            {options
              .slice()
              .sort((a, b) => a - b)
              .map(c => (
                <option key={c} value={String(c)}>
                  {fmt.temp(c)}
                </option>
              ))}
            <option value={NO_LIMIT}>{m.noLimit}</option>
          </select>
        </label>
      </div>
    </ActivityEditSection>
  )
}
