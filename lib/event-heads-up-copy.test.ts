import { describe, expect, it } from 'vitest'
import { EVENT_HEADS_UP } from '@solara/core/event-import'
import { eventHeadsUpRule, eventHeadsUpSentence, headsUpSources } from './event-heads-up-copy'

describe('event heads-up copy (REVIEW6 L1)', () => {
  it('names every switched-on source', () => {
    expect(headsUpSources(false, false)).toBe('a calendar file')
    expect(headsUpSources(true, false)).toBe('a calendar file or a linked calendar')
    expect(headsUpSources(false, true)).toBe('a calendar file or Google Calendar')
    expect(headsUpSources(true, true)).toBe('a calendar file, a linked calendar or Google Calendar')
  })

  it('states the outdoor-only rule and the 3-hour gap from the shared constants', () => {
    const all = 'a calendar file, a linked calendar or Google Calendar'
    expect(eventHeadsUpRule(all)).toBe(
      'about 3 hours before an outdoor event (one with an activity set) with UV 6 or higher, from a calendar file, a linked calendar or Google Calendar, at most one every 3 hours (it also counts the others coming up)',
    )
    expect(eventHeadsUpSentence(all)).toBe(
      'About 3 hours before an outdoor event (one with an activity set) with UV 6 or higher, from a calendar file, a linked calendar or Google Calendar, at most one every 3 hours (it also counts the others coming up).',
    )
    expect(EVENT_HEADS_UP).toMatchObject({ leadHours: 3, uv: 6, minGapHours: 3 })
  })
})
