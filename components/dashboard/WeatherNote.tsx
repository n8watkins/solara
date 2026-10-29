import { CloudRain, Thermometer } from 'lucide-react'
import { weatherText, type WeatherSpan } from '@solara/core/weather-fit'
import { useUnits } from '@/lib/use-units'

/** At most this many spans are named; a day rarely has more, and the card stays short. */
const MAX_SPANS = 3

/**
 * The rain or heat that moved a slot or took it away, one line per span: "Rain likely
 * 2pm–4pm", "Too hot 1pm–5pm, feels like 97°F" (ActivityDayPlan.weather).
 */
export default function WeatherNote({
  spans,
  className = '',
}: {
  spans: readonly WeatherSpan[]
  className?: string
}) {
  const fmt = useUnits()
  if (!spans.length) return null
  return (
    <ul className={`flex flex-col gap-1 ${className}`} data-testid="weather-note">
      {spans.slice(0, MAX_SPANS).map(span => {
        const Icon = span.kind === 'rain' ? CloudRain : Thermometer
        return (
          <li
            key={`${span.kind}-${span.from}`}
            data-kind={span.kind}
            className="flex items-start gap-1.5 text-[12px] leading-[1.4] text-ink-2"
          >
            <Icon size={14} aria-hidden className="mt-px shrink-0 text-ink-3" />
            <span className="min-w-0">{weatherText(span, fmt.time, fmt.temp)}</span>
          </li>
        )
      })}
    </ul>
  )
}
