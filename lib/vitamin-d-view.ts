// Pure view logic for the vitamin D log (components/vitamin-d): the session form's
// defaults, checks and the entry it saves, and the entry "Log it" makes from a finished
// activity. Every estimate comes from @solara/core/vitamin-d, the dashboard card's own.
import {
  ENTERED_UV_MAX,
  exposureForAreas,
  LOG_KEEP_DAYS,
  SESSION_MAX_MINUTES,
  startHour,
  type VitaminDEntry,
} from '@solara/core/vitamin-d-log'
import { forecastSpans, type SkinExposure, type UvSpan } from '@solara/core/vitamin-d-session'
import type { SkinType } from '@solara/core/recommendation'
import type { BodyArea } from '@solara/core/sunscreen'
import { shiftIsoDate } from '@solara/core/zoned-time'

/** What the log knows about now: the forecast's today, its hours and the skin type. */
export interface LogContext {
  /** The forecast place's date, YYYY-MM-DD. */
  today: string
  /** Fractional hour now on the place's clock. */
  nowHour: number
  /** Today's hourly forecast. */
  hourly: readonly { hour: number; uv: number }[]
  /** The plan's own skin type (Settings, Sun profile). */
  skinType: SkinType
}

/** The form's fields, as typed. */
export interface SessionForm {
  date: string
  start: string
  minutes: string
  exposure: SkinExposure
  sunscreen: boolean
  /** The UV typed for a day the forecast does not cover. */
  uv: string
}

export type FormField = 'date' | 'start' | 'minutes' | 'uv'

/** The earliest date a session may have. */
export function earliestDate(today: string): string {
  return shiftIsoDate(today, -LOG_KEEP_DAYS)
}

/** A fractional hour as HH:MM, rounded down to 5 minutes, within the day. */
export function clockText(hour: number): string {
  const minutes = Math.min(Math.max(0, Math.floor((hour * 60) / 5) * 5), 23 * 60 + 55)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** A new session: today, starting half an hour ago, 30 minutes in a T-shirt and shorts. */
export function newForm(context: Pick<LogContext, 'today' | 'nowHour'>): SessionForm {
  return {
    date: context.today,
    start: clockText(Math.max(0, context.nowHour - 0.5)),
    minutes: '30',
    exposure: 'arms-legs',
    sunscreen: false,
    uv: '',
  }
}

/** The mean UV of spans, to one decimal. */
export function meanUv(spans: readonly UvSpan[]): number {
  const minutes = spans.reduce((sum, span) => sum + span.minutes, 0)
  const uvMinutes = spans.reduce((sum, span) => sum + span.minutes * span.uv, 0)
  return minutes > 0 ? Math.round((uvMinutes / minutes) * 10) / 10 : 0
}

/** The form for editing an entry. */
export function formOf(entry: VitaminDEntry): SessionForm {
  return {
    date: entry.date,
    start: entry.start,
    minutes: String(entry.minutes),
    exposure: entry.exposure,
    sunscreen: entry.sunscreen,
    uv: entry.uvSource === 'entered' ? String(meanUv(entry.uv)) : '',
  }
}

/**
 * Where the form's UV comes from: the forecast for its today, the stored forecast hours of
 * an entry whose day and times did not change, else the person's own figure.
 */
export function uvSourceOf(
  form: Pick<SessionForm, 'date' | 'start' | 'minutes'>,
  context: Pick<LogContext, 'today' | 'hourly'>,
  editing: VitaminDEntry | null,
): 'forecast' | 'stored' | 'entered' {
  if (form.date === context.today && context.hourly.length > 0) return 'forecast'
  if (
    editing?.uvSource === 'forecast' &&
    editing.date === form.date &&
    editing.start === form.start &&
    String(editing.minutes) === form.minutes.trim()
  )
    return 'stored'
  return 'entered'
}

/** What a form describes, or which fields are wrong. */
export type FormResult =
  | { ok: true; uvSource: 'forecast' | 'entered'; uv: UvSpan[]; minutes: number }
  | { ok: false; errors: FormField[] }

/** Checks the form and works out its UV. */
export function readForm(
  form: SessionForm,
  context: Pick<LogContext, 'today' | 'hourly'>,
  editing: VitaminDEntry | null,
): FormResult {
  const errors: FormField[] = []
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(form.date) ||
    form.date > context.today ||
    form.date < earliestDate(context.today)
  )
    errors.push('date')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.start)) errors.push('start')
  const minutes = Number(form.minutes.trim())
  if (!/^\d+$/.test(form.minutes.trim()) || minutes < 1 || minutes > SESSION_MAX_MINUTES)
    errors.push('minutes')
  const source = uvSourceOf(form, context, editing)
  const uv = Number(form.uv.trim().replace(',', '.'))
  if (
    source === 'entered' &&
    (form.uv.trim() === '' || !Number.isFinite(uv) || uv < 0 || uv > ENTERED_UV_MAX)
  )
    errors.push('uv')
  if (errors.length > 0) return { ok: false, errors }
  if (source === 'forecast')
    return {
      ok: true,
      uvSource: 'forecast',
      uv: forecastSpans(context.hourly, startHour(form.start), minutes),
      minutes,
    }
  if (source === 'stored') return { ok: true, uvSource: 'forecast', uv: editing!.uv, minutes }
  return {
    ok: true,
    uvSource: 'entered',
    uv: [{ minutes, uv: Math.round(uv * 10) / 10 }],
    minutes,
  }
}

/** The entry a valid form saves. */
export function entryOf(
  form: SessionForm,
  result: Extract<FormResult, { ok: true }>,
  { id, skinType, editing }: { id: string; skinType: SkinType; editing: VitaminDEntry | null },
): VitaminDEntry {
  return {
    id,
    date: form.date,
    start: form.start,
    minutes: result.minutes,
    exposure: form.exposure,
    sunscreen: form.sunscreen,
    // An edit keeps the skin type it was logged with.
    skinType: editing?.skinType ?? skinType,
    uvSource: result.uvSource,
    uv: result.uv,
    ...(editing?.activityId ? { activityId: editing.activityId } : {}),
    ...(editing?.label ? { label: editing.label } : {}),
  }
}

/** A finished activity to log with one tap. */
export interface ActivityToLog {
  id: string
  name: string
  /** When the plan put it today, fractional hours on the place's clock. */
  startHour: number
  durationMins: number
  sunscreen: boolean
  /** The parts its preset usually leaves in the sun (activityBodyAreas). */
  areas: readonly BodyArea[]
}

/** The entry "Log it" makes for a finished activity, with the forecast's UV. */
export function activityEntry(
  activity: ActivityToLog,
  context: LogContext,
  id: string,
): VitaminDEntry {
  const start = clockText(activity.startHour)
  const minutes = Math.min(Math.max(1, Math.round(activity.durationMins)), SESSION_MAX_MINUTES)
  return {
    id,
    date: context.today,
    start,
    minutes,
    exposure: exposureForAreas(activity.areas),
    sunscreen: activity.sunscreen,
    skinType: context.skinType,
    uvSource: 'forecast',
    uv: forecastSpans(context.hourly, startHour(start), minutes),
    activityId: activity.id.slice(0, 100),
    label: activity.name.slice(0, 80),
  }
}
