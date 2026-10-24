'use client'
import { useId, useState } from 'react'
import type { Activity } from '@/lib/types'
import { clampDuration, customActivity, MIN_DURATION_MINS } from '@/lib/activity-presets'
import { SunscreenChoice } from './ActivityChoice'
import ActivityIconButton from './ActivityIconButton'

interface Props {
  /** At the plan's activity limit: the form cannot be opened. */
  disabled: boolean
  onAdd: (activity: Activity) => void
}

const DEFAULT_ICON = '🏃'
const DEFAULT_MINS = 30

/** The "Create custom activity" button and the form it opens. */
export default function ActivityCustomForm({ disabled, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [mins, setMins] = useState(DEFAULT_MINS)
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [sunscreen, setSunscreen] = useState(false)
  const id = useId()
  const durationId = `${id}-duration`
  const spfLabelId = `${id}-spf`

  function add() {
    if (!name.trim() || disabled) return
    onAdd(customActivity({ name, icon, durationMins: mins, sunscreen }, Date.now()))
    setName('')
    setMins(DEFAULT_MINS)
    setSunscreen(false)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="btn btn-primary w-full justify-center rounded-xl p-2.5 text-[14px]"
        disabled={disabled}
      >
        {open ? 'Cancel' : '+ Create custom activity'}
      </button>

      {open && (
        <div className="mt-2.5 flex flex-col gap-3 rounded-xl border-[0.5px] border-line-strong bg-surface-metric p-3.5">
          <div className="flex items-center gap-2.5">
            <ActivityIconButton value={icon} onChange={setIcon} label="Choose icon" />
            <input
              aria-label="Activity name"
              placeholder="Activity name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              className="min-w-0 flex-1 text-[14px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor={durationId} className="shrink-0 text-[13px] text-ink-2">
              Duration
            </label>
            <input
              id={durationId}
              type="number"
              min={MIN_DURATION_MINS}
              step="5"
              value={mins}
              onChange={e => setMins(clampDuration(parseInt(e.target.value)))}
              className="w-20 text-[13px]"
            />
            <span className="text-[13px] text-ink-3">min</span>
          </div>
          <span id={spfLabelId} className="sr-only">
            Sun protection
          </span>
          <SunscreenChoice aria-labelledby={spfLabelId} value={sunscreen} onChange={setSunscreen} />
          <button
            type="button"
            className="btn btn-primary justify-center"
            onClick={add}
            disabled={!name.trim()}
          >
            Add activity
          </button>
        </div>
      )}
    </div>
  )
}
