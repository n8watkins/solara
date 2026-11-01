'use client'
import type { ShadeLevel, Surface } from '@solara/core'
import { SHADE_OPTIONS, SURFACE_OPTIONS, exposurePercent } from '@/lib/activity-exposure'
import { ChoiceButton } from './ActivityChoice'
import { ActivityEditSection } from './ActivityEditSection'
import m from '@/messages/editor'

/**
 * "Shade and surface" in the Edit activity form: typical shade and the ground around
 * the activity, which scale the UV it is planned for (@solara/core exposure.ts).
 */
export function ActivityExposureSection({
  id,
  shade,
  surface,
  onChange,
}: {
  id: string
  shade: ShadeLevel | null
  surface: Surface | null
  onChange: (patch: { shade?: ShadeLevel | null; surface?: Surface | null }) => void
}) {
  return (
    <ActivityEditSection
      id={id}
      title={m.shadeSurface}
      description={m.shadeSurfaceHint}
      aside={
        <div className="shrink-0 text-right">
          <p className="text-[12px] text-ink-3">{m.plansFor}</p>
          <p className="mt-0.5 text-[18px] font-extrabold text-accent" aria-live="polite">
            {exposurePercent({ shade, surface })}
          </p>
          <p className="text-[11px] text-ink-3">{m.ofForecastUv}</p>
        </div>
      }
      wide
    >
      <div className="flex flex-col gap-2">
        <p id={`${id}-shade`} className="text-[12px] font-semibold text-ink-2">
          {m.typicalShade}
        </p>
        <div role="group" aria-labelledby={`${id}-shade`} className="flex gap-2">
          {SHADE_OPTIONS.map(option => (
            <ChoiceButton
              key={option.label}
              compact
              pressed={shade === option.value}
              onClick={() => onChange({ shade: option.value })}
            >
              {option.label}
            </ChoiceButton>
          ))}
        </div>
        <p id={`${id}-surface`} className="mt-1 text-[12px] font-semibold text-ink-2">
          {m.surfaceAround}
        </p>
        <div
          role="group"
          aria-labelledby={`${id}-surface`}
          className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        >
          {SURFACE_OPTIONS.map(option => (
            <ChoiceButton
              key={option.label}
              compact
              pressed={surface === option.value}
              onClick={() => onChange({ surface: option.value })}
            >
              {option.label}
            </ChoiceButton>
          ))}
        </div>
      </div>
    </ActivityEditSection>
  )
}
