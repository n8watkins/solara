import { useId, type FormEvent } from 'react'
import clsx from 'clsx'
import { SESSION_MAX_MINUTES, ENTERED_UV_MAX } from '@solara/core/vitamin-d-log'
import { estimateSession, SKIN_EXPOSURES, type SkinExposure } from '@solara/core/vitamin-d'
import { skinTypeSkin } from '@solara/core/recommendation'
import { formatUV } from '@solara/core/uv-scale'
import type { VitaminDEntry } from '@solara/core/vitamin-d-log'
import { formatDate } from '@/lib/time'
import {
  earliestDate,
  meanUv,
  readForm,
  uvSourceOf,
  type FormField,
  type LogContext,
  type SessionForm as Form,
} from '@/lib/vitamin-d-view'
import SessionEstimateLines from './SessionEstimateLines'
import m from '@/messages/vitamin-d'

const EXPOSURE_TEXT: Record<SkinExposure, { name: () => string; hint: () => string }> = {
  'face-hands': { name: () => m.exposureFaceHands, hint: () => m.exposureFaceHandsHint },
  'face-arms': { name: () => m.exposureFaceArms, hint: () => m.exposureFaceArmsHint },
  'arms-legs': { name: () => m.exposureArmsLegs, hint: () => m.exposureArmsLegsHint },
  swimwear: { name: () => m.exposureSwimwear, hint: () => m.exposureSwimwearHint },
}

/** A preset's name: "Arms and legs". */
export function exposureName(exposure: SkinExposure): string {
  return EXPOSURE_TEXT[exposure].name()
}

const FIELD = 'flex flex-col gap-1 text-[13px] font-medium text-ink-2'
const ERROR = 'text-[12px] font-medium text-danger'

/**
 * The session form: date, start, length, the skin in the sun and sunscreen, and the UV
 * when the forecast does not cover the day; the estimate updates as it is filled in.
 */
export default function SessionForm({
  id,
  form,
  onChange,
  errors,
  context,
  editing,
  onSubmit,
}: {
  id: string
  form: Form
  onChange: (form: Form) => void
  /** The fields a save found wrong; each says so under itself. */
  errors: readonly FormField[]
  context: LogContext
  editing: VitaminDEntry | null
  onSubmit: () => void
}) {
  const ids = {
    date: useId(),
    start: useId(),
    minutes: useId(),
    uv: useId(),
    sunscreenHint: useId(),
    exposure: useId(),
  }
  const source = uvSourceOf(form, context, editing)
  const result = readForm(form, context, editing)
  const skinType = editing?.skinType ?? context.skinType
  const estimate = result.ok
    ? estimateSession({
        spans: result.uv,
        skinType,
        exposure: form.exposure,
        sunscreen: form.sunscreen,
      })
    : null
  const set = (patch: Partial<Form>) => onChange({ ...form, ...patch })
  const errorId = (field: FormField) => `${id}-${field}-error`
  const invalid = (field: FormField) =>
    errors.includes(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': errorId(field) }
      : {}

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form id={id} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
        <label htmlFor={ids.date} className={FIELD}>
          {m.date}
          <input
            id={ids.date}
            type="date"
            value={form.date}
            min={earliestDate(context.today)}
            max={context.today}
            onChange={event => set({ date: event.target.value })}
            className="min-w-0"
            {...invalid('date')}
          />
        </label>
        <label htmlFor={ids.start} className={FIELD}>
          {m.startTime}
          <input
            id={ids.start}
            type="time"
            step={300}
            value={form.start}
            onChange={event => set({ start: event.target.value })}
            className="min-w-0"
            {...invalid('start')}
          />
        </label>
      </div>
      {errors.includes('date') && (
        <p id={errorId('date')} className={ERROR}>
          {m.invalidDate(formatDate(earliestDate(context.today), { dateStyle: 'medium' }))}
        </p>
      )}
      {errors.includes('start') && (
        <p id={errorId('start')} className={ERROR}>
          {m.invalidStart}
        </p>
      )}

      <label htmlFor={ids.minutes} className={FIELD}>
        {m.length}
        <input
          id={ids.minutes}
          type="number"
          inputMode="numeric"
          min={1}
          max={SESSION_MAX_MINUTES}
          step={1}
          value={form.minutes}
          onChange={event => set({ minutes: event.target.value })}
          className="w-28"
          {...invalid('minutes')}
        />
      </label>
      {errors.includes('minutes') && (
        <p id={errorId('minutes')} className={ERROR}>
          {m.invalidLength(SESSION_MAX_MINUTES)}
        </p>
      )}

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[13px] font-medium text-ink-2">{m.exposure}</legend>
        <div className="grid grid-cols-2 gap-2">
          {SKIN_EXPOSURES.map(exposure => (
            <label
              key={exposure}
              className={clsx(
                'relative flex cursor-pointer flex-col gap-0.5 rounded-xl border-[0.5px] px-3 py-2.5',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
                form.exposure === exposure
                  ? 'border-accent bg-accent-soft'
                  : 'border-line-strong bg-surface-metric',
              )}
            >
              <input
                type="radio"
                name={`${id}-exposure`}
                value={exposure}
                checked={form.exposure === exposure}
                onChange={() => set({ exposure })}
                className="sr-only"
              />
              <span className="text-[13px] font-semibold text-ink">
                {EXPOSURE_TEXT[exposure].name()}
              </span>
              <span className="text-[11px] leading-snug text-ink-3">
                {EXPOSURE_TEXT[exposure].hint()}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <input
            type="checkbox"
            checked={form.sunscreen}
            onChange={event => set({ sunscreen: event.target.checked })}
            aria-describedby={ids.sunscreenHint}
            className="size-4"
          />
          {m.sunscreen}
        </label>
        <p id={ids.sunscreenHint} className="ml-6 text-[12px] leading-snug text-ink-3">
          {m.sunscreenHint}
        </p>
      </div>

      {source === 'entered' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.uv} className={FIELD}>
            {m.uvIndex}
            <input
              id={ids.uv}
              type="number"
              inputMode="decimal"
              min={0}
              max={ENTERED_UV_MAX}
              step={0.1}
              value={form.uv}
              onChange={event => set({ uv: event.target.value })}
              className="w-28"
              aria-describedby={
                errors.includes('uv') ? `${errorId('uv')} ${ids.uv}-hint` : `${ids.uv}-hint`
              }
              aria-invalid={errors.includes('uv') || undefined}
            />
          </label>
          <p id={`${ids.uv}-hint`} className="text-[12px] leading-snug text-ink-3">
            {m.uvHint}
          </p>
          {errors.includes('uv') && (
            <p id={errorId('uv')} className={ERROR}>
              {m.invalidUv(ENTERED_UV_MAX)}
            </p>
          )}
        </div>
      ) : (
        result.ok && (
          <p className="text-[12px] text-ink-3" data-testid="vitd-form-uv">
            {m.uvFromForecast(formatUV(meanUv(result.uv)))}
          </p>
        )
      )}

      <div className="rounded-xl bg-surface-metric px-3.5 py-3" data-testid="vitd-form-estimate">
        <p className="mb-1 text-[11px] font-bold tracking-[0.055em] text-ink-3 uppercase">
          {m.preview}
        </p>
        {estimate && <SessionEstimateLines estimate={estimate} />}
        <p className="mt-1.5 text-[11px] text-ink-3">{m.skinTypeNote(skinTypeSkin(skinType))}</p>
      </div>
    </form>
  )
}
