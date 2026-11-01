'use client'
import clsx from 'clsx'
import type { TimePreference } from '@/lib/types'
import {
  dayInitials,
  dayNames,
  dayPresets,
  daysSummary,
  normalizedHours,
} from '@/lib/activity-form'
import { toggleInList } from '@/lib/activity-presets'
import { useUnits } from '@/lib/use-units'
import { ChoiceButton } from './ActivityChoice'
import { ActivityEditSection, SectionToggle } from './ActivityEditSection'
import m from '@/messages/editor'

interface HoursProps {
  id: string
  enabled: boolean
  from: number
  to: number
  onChange: (patch: {
    preferredEnabled?: boolean
    preferredFrom?: number
    preferredTo?: number
  }) => void
}

/** "Preferred hours": an optional earliest and latest hour for recommendations. */
export function PreferredHoursSection({ id, enabled, from, to, onChange }: HoursProps) {
  const fmt = useUnits()
  const hours = normalizedHours(from, to)
  const field = 'flex flex-col gap-[5px] text-[12px] text-ink-3'
  return (
    <ActivityEditSection
      id={id}
      title={m.preferredHours}
      description={m.preferredHoursHint}
      aside={
        <SectionToggle
          on={enabled}
          onToggle={() => onChange({ preferredEnabled: !enabled })}
          aria-describedby={`${id}-desc`}
        >
          {enabled ? m.enabled : m.anyTime}
        </SectionToggle>
      }
    >
      {enabled && (
        <div className="grid grid-cols-2 gap-2.5">
          <label className={field}>
            {m.earliest}
            <select
              value={hours.from}
              onChange={e => onChange({ preferredFrom: Number(e.target.value) })}
              className="text-[13px]"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {fmt.hour(h)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {m.latest}
            <select
              value={hours.to}
              onChange={e => onChange({ preferredTo: Number(e.target.value) })}
              className="text-[13px]"
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                <option key={h} value={h}>
                  {fmt.hour(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </ActivityEditSection>
  )
}

// Read when drawn, in the page's language.
const TIME_OPTIONS = [
  { value: 'earliest', label: () => m.earliest, hint: () => m.earliestHint },
  { value: 'latest', label: () => m.latest, hint: () => m.latestHint },
  { value: 'sunniest', label: () => m.sunniest, hint: () => m.sunniestHint },
] as const

/** "Preferred time": which matching window to recommend first. */
export function PreferredTimeSection({
  id,
  value,
  onChange,
}: {
  id: string
  value: TimePreference
  onChange: (value: TimePreference) => void
}) {
  return (
    <ActivityEditSection id={id} title={m.preferredTime} description={m.preferredTimeHint}>
      <div role="group" aria-labelledby={id} aria-describedby={`${id}-desc`} className="flex gap-2">
        {TIME_OPTIONS.map(o => (
          <ChoiceButton
            key={o.value}
            pressed={value === o.value}
            onClick={() => onChange(o.value)}
            title={o.hint()}
          >
            {o.label()}
          </ChoiceButton>
        ))}
      </div>
    </ActivityEditSection>
  )
}

/** "Days": the weekdays to plan the activity for, with one-tap presets. */
export function DaysSection({
  id,
  days,
  onChange,
}: {
  id: string
  days: number[]
  onChange: (days: number[]) => void
}) {
  return (
    <ActivityEditSection id={id} title={m.days} description={m.daysHint}>
      <div
        role="group"
        aria-labelledby={id}
        aria-describedby={`${id}-desc`}
        className="flex gap-1.5"
      >
        {dayNames().map((name, d) => {
          const on = days.includes(d)
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(toggleInList(days, d))}
              aria-pressed={on}
              aria-label={name}
              title={name}
              className={clsx(
                'flex-1 rounded-[10px] py-[9px] text-[13px] font-bold',
                on
                  ? 'border-[1.5px] border-accent bg-accent-soft text-accent'
                  : 'border-[0.5px] border-line-strong bg-surface-card text-ink-3',
              )}
            >
              {dayInitials()[d]}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {dayPresets().map(p => (
          <button
            key={p.label}
            type="button"
            className="btn px-[9px] py-[5px] text-[12px]"
            onClick={() => onChange([...p.days])}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[12px] text-ink-3">{daysSummary(days)}</span>
      </div>
    </ActivityEditSection>
  )
}
