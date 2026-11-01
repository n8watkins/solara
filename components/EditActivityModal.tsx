'use client'
import { useId, useState } from 'react'
import type { Activity } from '@/lib/types'
import { activityEdited } from '@/lib/activity-draft'
import { activityForm, activityFromForm, clampUV, type ActivityForm } from '@/lib/activity-form'
import { clampDuration, MIN_DURATION_MINS } from '@/lib/activity-presets'
import { effectiveMaxUV } from '@solara/core/tiers'
import { SunscreenChoice } from './ActivityChoice'
import { ActivityEditSection, SectionToggle } from './ActivityEditSection'
import { ActivityExposureSection } from './ActivityExposureSection'
import { ActivityWeatherSection } from './ActivityWeatherSection'
import ActivityIconButton from './ActivityIconButton'
import ActivityModalShell from './ActivityModalShell'
import { DaysSection, PreferredHoursSection, PreferredTimeSection } from './ActivityScheduleFields'
import m from '@/messages/editor'

interface Props {
  activity: Activity
  onSave: (activity: Activity) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export default function EditActivityModal({ activity, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<ActivityForm>(() => activityForm(activity))
  const update = (patch: Partial<ActivityForm>) => setForm(f => ({ ...f, ...patch }))
  const id = useId()
  const ids = {
    name: `${id}-name`,
    duration: `${id}-duration`,
    hours: `${id}-hours`,
    time: `${id}-time`,
    days: `${id}-days`,
    spf: `${id}-spf`,
    cloud: `${id}-cloud`,
    exposure: `${id}-exposure`,
    weather: `${id}-weather`,
    uv: `${id}-uv`,
  }

  const draft = activityFromForm(activity, form)
  const dirty = activityEdited(activity, draft)

  function requestClose() {
    if (dirty && !window.confirm(m.discardConfirm)) return
    onClose()
  }

  function handleDelete() {
    if (!window.confirm(m.removeConfirm(activity.name))) return
    onDelete(activity.id)
  }

  return (
    <ActivityModalShell
      title={m.editActivity}
      description={m.editLead}
      onClose={requestClose}
      footer={
        <div className="flex flex-wrap justify-between gap-2.5">
          <button type="button" className="btn border-danger/30 text-danger" onClick={handleDelete}>
            {m.delete}
          </button>
          <div className="ml-auto flex gap-2.5">
            <button type="button" className="btn" onClick={requestClose}>
              {m.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onSave(draft)}
              disabled={!form.name.trim()}
            >
              {m.saveActivity}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        <div className="metric-card col-span-full flex items-center gap-3">
          <ActivityIconButton
            value={form.icon}
            onChange={icon => update({ icon })}
            label={m.changeIcon}
            size="lg"
          />
          <div className="flex-1">
            <label htmlFor={ids.name} className="mb-[5px] block text-[12px] text-ink-3">
              {m.activityName}
            </label>
            <input
              id={ids.name}
              value={form.name}
              onChange={e => update({ name: e.target.value })}
              placeholder={m.activityName}
              className="w-full text-[15px]"
            />
          </div>
        </div>

        <ActivityEditSection
          id={ids.duration}
          title={<label htmlFor={`${ids.duration}-input`}>{m.duration}</label>}
          description={m.durationHint}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => update({ durationMins: clampDuration(form.durationMins - 15) })}
            >
              {m.minus15}
            </button>
            <input
              type="number"
              min={MIN_DURATION_MINS}
              step="5"
              value={form.durationMins}
              id={`${ids.duration}-input`}
              aria-describedby={`${ids.duration}-desc`}
              onChange={e => update({ durationMins: clampDuration(parseInt(e.target.value)) })}
              className="w-24 text-[14px]"
            />
            <span className="text-[13px] text-ink-3">{m.minutes}</span>
            <button
              type="button"
              className="btn"
              onClick={() => update({ durationMins: form.durationMins + 15 })}
            >
              {m.plus15}
            </button>
          </div>
        </ActivityEditSection>

        <PreferredHoursSection
          id={ids.hours}
          enabled={form.preferredEnabled}
          from={form.preferredFrom}
          to={form.preferredTo}
          onChange={update}
        />

        <PreferredTimeSection
          id={ids.time}
          value={form.timePreference}
          onChange={timePreference => update({ timePreference })}
        />

        <DaysSection id={ids.days} days={form.days} onChange={days => update({ days })} />

        <ActivityEditSection id={ids.spf} title={m.sunProtection} description={m.sunProtectionHint}>
          <SunscreenChoice
            aria-labelledby={ids.spf}
            aria-describedby={`${ids.spf}-desc`}
            value={form.sunscreen}
            onChange={sunscreen => update({ sunscreen })}
          />
        </ActivityEditSection>

        <ActivityEditSection
          id={ids.cloud}
          title={m.cloudCover}
          description={m.cloudCoverHint}
          aside={
            <SectionToggle
              on={form.cloudSensitive}
              onToggle={() => update({ cloudSensitive: !form.cloudSensitive })}
              id={`${ids.cloud}-toggle`}
              aria-labelledby={`${ids.cloud} ${ids.cloud}-toggle`}
              aria-describedby={`${ids.cloud}-desc`}
            >
              {form.cloudSensitive ? m.on : m.off}
            </SectionToggle>
          }
        />

        <ActivityWeatherSection
          id={ids.weather}
          avoidRain={form.avoidRain}
          maxFeelsLikeC={form.maxFeelsLikeC}
          onChange={update}
        />

        <ActivityExposureSection
          id={ids.exposure}
          shade={form.shade}
          surface={form.surface}
          onChange={update}
        />

        <ActivityEditSection
          id={ids.uv}
          title={<label htmlFor={`${ids.uv}-range`}>{m.baseLimit}</label>}
          description={m.baseLimitHint}
          aside={
            <div className="shrink-0 text-right">
              <p className="text-[12px] text-ink-3">{m.effectiveLimit}</p>
              <p className="mt-0.5 text-[22px] font-extrabold text-accent">
                {effectiveMaxUV(draft)}
              </p>
            </div>
          }
          wide
        >
          <input
            type="range"
            min="0"
            max="11"
            step="0.5"
            value={form.maxUV}
            id={`${ids.uv}-range`}
            aria-describedby={`${ids.uv}-desc`}
            onChange={e => update({ maxUV: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ink-3">{m.strict}</span>
            <input
              type="number"
              min="0"
              max="11"
              step="0.5"
              value={form.maxUV}
              aria-labelledby={ids.uv}
              onChange={e => update({ maxUV: clampUV(parseFloat(e.target.value)) })}
              className="w-[90px] text-center text-[13px]"
            />
            <span className="text-[12px] text-ink-3">{m.flexible}</span>
          </div>
        </ActivityEditSection>
      </div>
    </ActivityModalShell>
  )
}
