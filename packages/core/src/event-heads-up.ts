// The Pro heads-up before an event with high UV (docs/integrations/EVENTS.md, phase 2):
// a push a few hours before an imported or linked event whose peak UV is high, sent by
// the scheduled `alerts` Function (functions/src/notifications/alerts.ts) with the
// morning and UV alerts' devices, quiet hours and at-most-once delivery.
//
// Which events get one (REVIEW5 M3, defaults, owner may change, 2026-10-28):
//
// - only events that count as an outdoor activity (`countsAsOutdoorActivity`), so a
//   linked work calendar's meetings get none;
// - one per event as people see it: the same title starting within
//   `duplicateMinutes` counts once, whether it came from a file, a linked calendar or
//   (later) Google Calendar, and whatever key it is stored under (`sameEvent`);
// - at most one push per account every `minGapHours`, naming the soonest high-UV event
//   and how many more are coming up;
// - every qualifying event in the window is looked at, not just the soonest few;
// - a push also stands for every high-UV outdoor event that could not get a heads-up of
//   its own after it, because its due window closes within the gap (REVIEW6 L2,
//   `eventHeadsUpLaterPossible`), so no qualifying event is silently dropped.
//
// The event's title comes from whoever published the calendar, so a push frames it as
// the event's name, in quotes, and cleans it: invisible formatting, links, e-mail
// addresses and phone numbers removed, and cut to `titleLength` (REVIEW5 L4).
//
// Pure, so the timing, the choice and the words are unit tested here.

import {
  type AlertMessage,
  type QuietHours,
  formatAlertTime,
  inQuietHours,
  localTime,
} from './alerts'
import { stripInvisibleFormatting } from './ics-parse'
import { formatUV } from './uv-scale'

/** Defaults, owner may change (docs/ROADMAP.md decisions, 2026-10-28). */
export const EVENT_HEADS_UP = Object.freeze({
  /** A heads-up goes out for an event whose peak UV index reaches this (WHO "high"). */
  uv: 6,
  /** It goes out this long before the start... */
  leadHours: 3,
  /** ...and never later than this before the start. */
  latestMinutes: 15,
  /** When the lead time falls in quiet hours, it may move this far earlier (the evening before). */
  maxShiftHours: 16,
  /** Events starting within this many hours are looked at in each run. */
  lookaheadHours: 20,
  /** At most one heads-up push per account in this many hours (REVIEW5 M3). */
  minGapHours: 3,
  /** Events with the same title whose starts are this close count as one (REVIEW5 M3). */
  duplicateMinutes: 30,
  /** The longest event title a push quotes (REVIEW5 L4). */
  titleLength: 40,
  /** The longest place name a push quotes. */
  placeLength: 60,
  /** The `alerts` job runs this often (functions/src/notifications/functions.ts). */
  runMinutes: 15,
})

// ---- Which events ---------------------------------------------------------------------

/**
 * Whether an event counts as an outdoor activity, the only kind that gets a heads-up
 * (REVIEW5 M3). Every Solara activity is something done outside (the presets in
 * tiers.ts, and the person's own), so an event counts when its `activityId` names
 * one of the person's activities: set by the title matcher when it was imported
 * (`matchActivity`: "Saturday 10K" is Running) or chosen by the person on the event.
 * An event with no activity ('', "No activity" in the app), or with an activity the
 * person has since removed, does not: that is how a meeting, a dinner or anything
 * indoors reads. Shared by every event source (files, linked calendars, Google Calendar).
 */
export function countsAsOutdoorActivity(
  event: { activityId: string },
  activities: readonly { id: string }[],
): boolean {
  return event.activityId !== '' && activities.some(activity => activity.id === event.activityId)
}

/** A title as people read it: case, accents' forms, punctuation and spacing ignored. */
export function eventTitleIdentity(title: string): string {
  return stripInvisibleFormatting(title.normalize('NFKC'))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Whether two stored events are the same event to the person: the same title (as
 * `eventTitleIdentity` reads it) starting within `duplicateMinutes` of each other, from
 * whichever source and under whichever key (REVIEW5 M3).
 */
export function sameEvent(
  a: { title: string; startMs: number },
  b: { title: string; startMs: number },
): boolean {
  return (
    Math.abs(a.startMs - b.startMs) <= EVENT_HEADS_UP.duplicateMinutes * 60_000 &&
    eventTitleIdentity(a.title) === eventTitleIdentity(b.title)
  )
}

/** The events with every later copy of an earlier one (`sameEvent`) left out, in order. */
export function withoutDuplicates<T extends { title: string; startMs: number }>(
  events: readonly T[],
): T[] {
  const kept: T[] = []
  for (const event of events) if (!kept.some(other => sameEvent(other, event))) kept.push(event)
  return kept
}

/** Whether the last heads-up (epoch ms, or null for none) is too recent for another. */
export function eventHeadsUpThrottled(lastSentMs: number | null, nowMs: number): boolean {
  return lastSentMs !== null && nowMs - lastSentMs < EVENT_HEADS_UP.minGapHours * 3_600_000
}

/**
 * The latest start (epoch ms) of an event whose heads-up can be due at `nowMs`: the lead
 * time ahead, or, in the last hour before quiet hours (when heads-ups for the morning
 * after go out, `eventHeadsUpFrom`), `lookaheadHours` ahead. A run reads only the events
 * starting before it, so most runs read the next 3 hours of events, not the next 20.
 */
export function eventHeadsUpWindowEnd(nowMs: number, timeZone: string, quiet: QuietHours): number {
  const inAnHour = localTime(new Date(nowMs + 3_600_000), timeZone)
  const beforeQuiet = !inAnHour || inQuietHours(inAnHour.hour, quiet)
  const hours = beforeQuiet ? EVENT_HEADS_UP.lookaheadHours : EVENT_HEADS_UP.leadHours
  return nowMs + hours * 3_600_000
}

/**
 * When the heads-up for an event may go out, as epoch ms: `leadHours` before the start,
 * or, when that falls in the person's quiet hours, the last whole hour before the quiet
 * hours began (the evening before an early start). `timeZone` is the person's own.
 */
export function eventHeadsUpFrom(startMs: number, timeZone: string, quiet: QuietHours): number {
  const target = startMs - EVENT_HEADS_UP.leadHours * 3_600_000
  const at = (ms: number) => localTime(new Date(ms), timeZone)
  const local = at(target)
  if (!local || !inQuietHours(local.hour, quiet)) return target
  // Step back to the end of the last hour before quiet hours started.
  const intoHour = (local.hour % 1) * 3_600_000
  let probe = target - intoHour
  for (let step = 0; step < EVENT_HEADS_UP.maxShiftHours; step += 1) {
    const previous = probe - 3_600_000
    const hour = at(previous)
    if (hour && !inQuietHours(hour.hour, quiet)) return previous
    probe = previous
  }
  return target
}

/**
 * Whether an event's heads-up is due now: from `eventHeadsUpFrom` until `latestMinutes`
 * before the start, outside quiet hours.
 */
export function eventHeadsUpDue({
  startMs,
  nowMs,
  timeZone,
  quiet,
}: {
  startMs: number
  nowMs: number
  /** The person's own time zone (their quiet hours are in it). */
  timeZone: string
  quiet: QuietHours
}): boolean {
  if (nowMs >= startMs - EVENT_HEADS_UP.latestMinutes * 60_000) return false
  if (nowMs < eventHeadsUpFrom(startMs, timeZone, quiet)) return false
  const local = localTime(new Date(nowMs), timeZone)
  return !!local && !inQuietHours(local.hour, quiet)
}

/**
 * Whether an event can still get a heads-up of its own from `fromMs` on (the end of the
 * gap after a push sent now, `minGapHours`): some later run of the `alerts` job, every
 * `runMinutes` on the clock, finds it due (`eventHeadsUpDue`). When it cannot, a push
 * sent now must stand for it ("and 1 more"), or the person never hears about it: a 10K
 * at 12:15 behind a 1K at noon, whose due window closes before the gap ends (REVIEW6 L2).
 */
export function eventHeadsUpLaterPossible({
  startMs,
  fromMs,
  timeZone,
  quiet,
}: {
  startMs: number
  fromMs: number
  /** The person's own time zone (their quiet hours are in it). */
  timeZone: string
  quiet: QuietHours
}): boolean {
  const step = EVENT_HEADS_UP.runMinutes * 60_000
  const last = startMs - EVENT_HEADS_UP.latestMinutes * 60_000
  // The first run from when the heads-up could be due, and no earlier than `fromMs`.
  const first = Math.max(fromMs, eventHeadsUpFrom(startMs, timeZone, quiet))
  for (let at = Math.ceil(first / step) * step; at < last; at += step) {
    if (eventHeadsUpDue({ startMs, nowMs: at, timeZone, quiet })) return true
  }
  return false
}

/** Whether a peak UV is high enough for a heads-up (the UV index reads whole numbers). */
export function eventHeadsUpWorthy(peakUV: number): boolean {
  return Number.isFinite(peakUV) && Math.round(peakUV) >= EVENT_HEADS_UP.uv
}

// ---- What it says ---------------------------------------------------------------------

/** Links, bare domains ("evil.example/pay"), e-mail addresses. */
const LINKS =
  /(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*|\S+@\S+|\b(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}\b(?:\/\S*)?/giu
/** Runs of digits and phone punctuation; removed when they hold 8 or more digits. */
const NUMBER_RUNS = /\+?\d[\d\s().\/-]*\d/g
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Text from a calendar's publisher made fit for a push (REVIEW5 L4): invisible
 * formatting and control characters, links, bare domains, e-mail addresses and phone
 * numbers removed, spaces collapsed, and cut to `max` characters at a word where it can.
 */
export function pushSafeText(text: string, max: number): string {
  const cleaned = stripInvisibleFormatting(text.normalize('NFKC'))
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(LINKS, ' ')
    .replace(NUMBER_RUNS, run =>
      (run.match(/\d/g)?.length ?? 0) >= 8 && !ISO_DATE.test(run) ? ' ' : run,
    )
    .replace(/[“”"]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;!?/-]+|[\s,:;/-]+$/g, '')
  const chars = Array.from(cleaned)
  if (chars.length <= max) return cleaned
  const cut = chars.slice(0, max - 1).join('')
  const word = cut.lastIndexOf(' ')
  return `${(word >= max / 2 ? cut.slice(0, word) : cut).replace(/[\s,.:;!?/-]+$/, '')}…`
}

export interface EventHeadsUpInput {
  title: string
  /** Where the UV is forecast ("Balboa Park" or "San Diego, California"). */
  placeLabel: string
  startMs: number
  /** The event place's zone, for the times in the message. */
  timeZone: string
  peakUV: number
  peakAtMs: number
  nowMs: number
  clock?: '12h' | '24h'
  /**
   * Other high-UV events this push stands for: those due now, and those that could not
   * get a heads-up of their own after it (`eventHeadsUpLaterPossible`).
   */
  more?: number
}

/**
 * "🗓️ UV up to 7.2 during your event at 8am", with the event's name, quoted and cleaned,
 * the place, and sunscreen timing in the body. Only the body quotes the publisher's
 * text, framed as the event's name (REVIEW5 L4).
 */
export function eventHeadsUpMessage({
  title,
  placeLabel,
  startMs,
  timeZone,
  peakUV,
  peakAtMs,
  nowMs,
  clock,
  more = 0,
}: EventHeadsUpInput): AlertMessage {
  const local = (ms: number) => localTime(new Date(ms), timeZone)
  const time = (ms: number) => {
    const at = local(ms)
    return at ? formatAlertTime(at.hour, clock) : ''
  }
  const startDay = local(startMs)?.date
  const today = local(nowMs)?.date
  const at = time(startMs)
  const event = !at
    ? 'your event soon'
    : startDay && today && startDay !== today
      ? `your event tomorrow at ${at}`
      : `your ${at} event`
  const name = pushSafeText(title, EVENT_HEADS_UP.titleLength)
  const place = pushSafeText(placeLabel, EVENT_HEADS_UP.placeLength)
  const others =
    more > 0
      ? ` ${more === 1 ? '1 more of your events' : `${more} more of your events`} coming up ${more === 1 ? 'reaches' : 'reach'} high UV too.`
      : ''
  return {
    title: `🗓️ UV up to ${formatUV(peakUV)} during ${event}`,
    body:
      `${name ? `Event: “${name}”. ` : ''}` +
      `${place ? `Forecast for ${place}: ` : ''}UV peaks at ${formatUV(peakUV)} around ${time(peakAtMs)}. ` +
      `Apply sunscreen 15 to 30 minutes before you go, reapply every 2 hours, and plan for shade.` +
      others,
  }
}
