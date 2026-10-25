'use client'
import { X } from 'lucide-react'
import type { Activity } from '@/lib/types'
import {
  clampDuration,
  MIN_DURATION_MINS,
  removeActivity,
  updateActivity,
} from '@/lib/activity-presets'
import { SunscreenChoice } from './ActivityChoice'

interface Props {
  activities: Activity[]
  onChange: (activities: Activity[]) => void
  /** Switch to the preset browser, offered when the list is empty. */
  onBrowse: () => void
}

const STEP_BUTTON = 'size-6 rounded-md border-[0.5px] border-line-strong text-[14px] text-ink-2'

/** The "My activities" list: quick duration, SPF and remove controls per activity. */
export default function ActivitySelectedList({ activities, onChange, onBrowse }: Props) {
  if (activities.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="mb-2.5 text-[13px] text-ink-3">No activities added yet.</p>
        <button type="button" onClick={onBrowse} className="text-[13px] font-semibold text-accent">
          Browse suggestions →
        </button>
      </div>
    )
  }

  const setDuration = (a: Activity, mins: number) =>
    onChange(updateActivity(activities, a.id, { durationMins: clampDuration(mins) }))

  return (
    <div className="flex flex-col gap-2">
      {activities.map(a => (
        <div
          key={a.id}
          className="rounded-[10px] border-[0.5px] border-line-strong bg-surface-card px-3 py-2.5"
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span aria-hidden="true" className="text-[18px]">
              {a.icon}
            </span>
            <span className="flex-1 text-[13px] font-medium text-ink">{a.name}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`${a.name}: 5 minutes shorter`}
                onClick={() => setDuration(a, a.durationMins - 5)}
                className={STEP_BUTTON}
              >
                −
              </button>
              <input
                type="number"
                min={MIN_DURATION_MINS}
                step="5"
                value={a.durationMins}
                aria-label={`${a.name} duration in minutes`}
                onChange={e => setDuration(a, parseInt(e.target.value))}
                className="w-11 rounded-[5px] px-1 py-0.5 text-center text-[12px]"
              />
              <span className="text-[11px] text-ink-3">min</span>
              <button
                type="button"
                aria-label={`${a.name}: 5 minutes longer`}
                onClick={() => setDuration(a, a.durationMins + 5)}
                className={STEP_BUTTON}
              >
                +
              </button>
            </div>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onChange(removeActivity(activities, a.id))}
              className="flex size-6 items-center justify-center text-ink-3"
            >
              <X size={15} />
            </button>
          </div>
          <SunscreenChoice
            aria-label={`${a.name} sun protection`}
            value={a.sunscreen}
            onChange={sunscreen => onChange(updateActivity(activities, a.id, { sunscreen }))}
            compact
          />
        </div>
      ))}
    </div>
  )
}
