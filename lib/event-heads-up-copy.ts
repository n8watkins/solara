// The one description of Pro event heads-ups (REVIEW6 L1), for Settings and the Events
// section, so the two never drift from the rule in packages/core/src/event-heads-up.ts:
// only outdoor events (one with an activity set), UV 6 or higher, about 3 hours before,
// from any source, at most one every 3 hours, which also counts the high-UV events after
// it that cannot get their own (REVIEW6 L2).
import { EVENT_HEADS_UP } from '@solara/core/event-import'
import { eventSubscriptionsLaunched, googleCalendarEventsLaunched } from './plans'
import core from '@solara/core/messages/core'
import m from '@/messages/events'

/** PURE. "a calendar file, a linked calendar or Google Calendar", as switched on. */
export function headsUpSources(
  linked = eventSubscriptionsLaunched(),
  google = googleCalendarEventsLaunched(),
): string {
  const sources = [
    m.headsUpSourceFile,
    ...(linked ? [m.headsUpSourceLinked] : []),
    ...(google ? [m.googleCalendar] : []),
  ]
  return core.listOr(sources)
}

/**
 * The rule as a clause, "about 3 hours before an outdoor event (one with an activity set)
 * with UV 6 or higher, from a calendar file, a linked calendar or Google Calendar, at most
 * one every 3 hours (it also counts the others coming up)".
 */
export function eventHeadsUpRule(sources = headsUpSources()): string {
  return m.headsUpRule(
    EVENT_HEADS_UP.leadHours,
    EVENT_HEADS_UP.uv,
    sources,
    EVENT_HEADS_UP.minGapHours,
  )
}

/** The rule as a sentence, for Settings' heads-up switch. */
export function eventHeadsUpSentence(sources = headsUpSources()): string {
  const rule = eventHeadsUpRule(sources)
  return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}.`
}
