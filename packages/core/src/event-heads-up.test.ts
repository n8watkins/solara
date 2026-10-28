import { describe, expect, it } from 'vitest'
import {
  EVENT_HEADS_UP,
  countsAsOutdoorActivity,
  eventHeadsUpDue,
  eventHeadsUpFrom,
  eventHeadsUpMessage,
  eventHeadsUpThrottled,
  eventHeadsUpWindowEnd,
  eventHeadsUpWorthy,
  eventTitleIdentity,
  pushSafeText,
  sameEvent,
  withoutDuplicates,
} from './event-heads-up'

const ZONE = 'America/Los_Angeles'
const QUIET = { from: 21, to: 7 }
// 2026-06-16 in Los Angeles is UTC-7.
const la = (day: number, hour: number) => Date.UTC(2026, 5, day, hour + 7)

describe('eventHeadsUpFrom', () => {
  it('is the lead time before the start outside quiet hours', () => {
    expect(eventHeadsUpFrom(la(16, 13), ZONE, QUIET)).toBe(la(16, 10))
  })

  it('moves to the last hour before quiet hours for an early start', () => {
    // 8am start: 5am is quiet, so the evening before at 8pm.
    expect(eventHeadsUpFrom(la(16, 8), ZONE, QUIET)).toBe(la(15, 20))
  })
})

describe('eventHeadsUpDue', () => {
  const due = (now: number, start: number) =>
    eventHeadsUpDue({ startMs: start, nowMs: now, timeZone: ZONE, quiet: QUIET })

  it('is due from the lead time until shortly before the start', () => {
    const start = la(16, 13)
    expect(due(la(16, 9.5), start)).toBe(false)
    expect(due(la(16, 10), start)).toBe(true)
    expect(due(la(16, 12.5), start)).toBe(true)
    expect(due(start - EVENT_HEADS_UP.latestMinutes * 60_000, start)).toBe(false)
  })

  it('never goes out in quiet hours', () => {
    const start = la(16, 8)
    expect(due(la(15, 20.5), start)).toBe(true)
    expect(due(la(15, 22), start)).toBe(false)
    expect(due(la(16, 6), start)).toBe(false)
    expect(due(la(16, 7.25), start)).toBe(true)
  })
})

describe('eventHeadsUpWorthy', () => {
  it('reads whole UV numbers from the high band', () => {
    expect(eventHeadsUpWorthy(5.4)).toBe(false)
    expect(eventHeadsUpWorthy(5.5)).toBe(true)
    expect(eventHeadsUpWorthy(Number.NaN)).toBe(false)
  })
})

describe('eventHeadsUpWindowEnd', () => {
  it('reads the lead time ahead, and the night ahead just before quiet hours', () => {
    expect(eventHeadsUpWindowEnd(la(16, 10), ZONE, QUIET)).toBe(la(16, 13))
    // 8:30pm: quiet hours start at 9pm, so the heads-ups for tomorrow morning are due.
    const evening = la(15, 20) + 30 * 60_000
    expect(eventHeadsUpWindowEnd(evening, ZONE, QUIET)).toBe(evening + 20 * 3_600_000)
  })

  it('covers every event whose heads-up is due, for any quiet hours (REVIEW5 M3)', () => {
    for (const quiet of [QUIET, { from: 22, to: 6 }, { from: 0, to: 9 }, { from: 5, to: 5 }]) {
      for (let now = la(15, 0); now < la(17, 0); now += 30 * 60_000) {
        const end = eventHeadsUpWindowEnd(now, ZONE, quiet)
        for (let start = now; start < now + 24 * 3_600_000; start += 20 * 60_000) {
          if (eventHeadsUpDue({ startMs: start, nowMs: now, timeZone: ZONE, quiet })) {
            expect(
              start,
              `${new Date(now).toISOString()} ${JSON.stringify(quiet)}`,
            ).toBeLessThanOrEqual(end)
          }
        }
      }
    }
  }, 30_000)
})

describe('which events get a heads-up (REVIEW5 M3)', () => {
  const activities = [{ id: 'run' }, { id: 'hike' }]

  it("only events that count as one of the person's outdoor activities", () => {
    expect(countsAsOutdoorActivity({ activityId: 'run' }, activities)).toBe(true)
    // "No activity" (a meeting, a dinner) and an activity the person removed do not.
    expect(countsAsOutdoorActivity({ activityId: '' }, activities)).toBe(false)
    expect(countsAsOutdoorActivity({ activityId: 'golf' }, activities)).toBe(false)
  })

  it('counts the same event from two sources once', () => {
    const start = la(16, 13)
    expect(eventTitleIdentity('  Saturday   10K! ')).toBe('saturday 10k')
    expect(
      sameEvent(
        { title: 'Saturday 10K', startMs: start },
        { title: 'saturday 10k', startMs: start + 30 * 60_000 },
      ),
    ).toBe(true)
    expect(
      sameEvent(
        { title: 'Saturday 10K', startMs: start },
        { title: 'Saturday\u200b 10K', startMs: start },
      ),
    ).toBe(true)
    expect(
      sameEvent(
        { title: 'Saturday 10K', startMs: start },
        { title: 'Saturday 10K', startMs: start + 31 * 60_000 },
      ),
    ).toBe(false)
    expect(
      sameEvent({ title: 'Saturday 10K', startMs: start }, { title: 'Sunday 10K', startMs: start }),
    ).toBe(false)
    const kept = withoutDuplicates([
      { key: 'file', title: 'Saturday 10K', startMs: start },
      { key: 'feed', title: 'Saturday 10K', startMs: start },
      { key: 'later', title: 'Saturday 10K', startMs: start + 24 * 3_600_000 },
    ])
    expect(kept.map(event => event.key)).toEqual(['file', 'later'])
  })

  it('at most one push every 3 hours', () => {
    expect(EVENT_HEADS_UP.minGapHours).toBe(3)
    expect(eventHeadsUpThrottled(null, la(16, 10))).toBe(false)
    expect(eventHeadsUpThrottled(la(16, 7) + 30 * 60_000, la(16, 10))).toBe(true)
    expect(eventHeadsUpThrottled(la(16, 7), la(16, 10))).toBe(false)
  })
})

describe('pushSafeText (REVIEW5 L4)', () => {
  it('removes links, domains, e-mail addresses and phone numbers', () => {
    expect(pushSafeText('Your Solara Pro payment failed, update it at evil.example', 80)).toBe(
      'Your Solara Pro payment failed, update it at',
    )
    expect(pushSafeText('Pay now https://evil.example/x?y=1 or www.evil.example', 80)).toBe(
      'Pay now or',
    )
    expect(pushSafeText('Write billing@evil.example today', 80)).toBe('Write today')
    expect(pushSafeText('Call +1 (800) 555-0199 now', 80)).toBe('Call now')
    // Race names keep their numbers and dates.
    expect(pushSafeText('Saturday 10K 2026-06-20, 5.5 mi', 80)).toBe(
      'Saturday 10K 2026-06-20, 5.5 mi',
    )
  })

  it('removes invisible formatting and control characters, and cuts long text at a word', () => {
    // "photo\u202egnp.exe" would read as "photoexe.png"; a file name is removed like a link.
    expect(pushSafeText('Club run \u2066photo\u202egnp.exe\u2069', 80)).toBe('Club run')
    expect(pushSafeText('Tempo\u200b run', 80)).toBe('Tempo run')
    expect(pushSafeText('a\u0007b\nc', 80)).toBe('a b c')
    const long = pushSafeText('Annual community charity fun run and festival in the park', 40)
    expect(long).toBe('Annual community charity fun run and…')
    expect(Array.from(long).length).toBeLessThanOrEqual(40)
    expect(pushSafeText('x'.repeat(60), 40)).toBe(`${'x'.repeat(39)}…`)
  })
})

describe('eventHeadsUpMessage', () => {
  it('names the event, its time, the peak and sunscreen timing', () => {
    const message = eventHeadsUpMessage({
      title: 'Saturday 10K',
      placeLabel: 'Balboa Park',
      startMs: la(16, 8),
      timeZone: ZONE,
      peakUV: 7.24,
      peakAtMs: la(16, 10),
      nowMs: la(15, 20),
      clock: '12h',
    })
    expect(message.title).toBe('🗓️ UV up to 7.2 during your event tomorrow at 8am')
    expect(message.body).toBe(
      'Event: “Saturday 10K”. Forecast for Balboa Park: UV peaks at 7.2 around 10am. ' +
        'Apply sunscreen 15 to 30 minutes before you go, reapply every 2 hours, and plan for shade.',
    )
  })

  it('works without a title or place', () => {
    const message = eventHeadsUpMessage({
      title: ' ',
      placeLabel: '',
      startMs: la(16, 13),
      timeZone: ZONE,
      peakUV: 8,
      peakAtMs: la(16, 13),
      nowMs: la(16, 10),
      clock: '24h',
    })
    expect(message.title).toBe('🗓️ UV up to 8.0 during your 13:00 event')
    expect(message.body.startsWith('UV peaks')).toBe(true)
  })

  it("frames a publisher's title as the event's name, cleaned and short (REVIEW5 L4)", () => {
    const message = eventHeadsUpMessage({
      title: 'Your Solara Pro payment failed, update it at evil.example or call 1-800-555-0199',
      placeLabel: 'Balboa Park',
      startMs: la(16, 13),
      timeZone: ZONE,
      peakUV: 8,
      peakAtMs: la(16, 13),
      nowMs: la(16, 10),
    })
    expect(message.title).toBe('🗓️ UV up to 8.0 during your 1pm event')
    expect(message.title).not.toMatch(/payment/)
    expect(message.body).toMatch(/^Event: “Your Solara Pro payment failed, update…”\. Forecast/)
    expect(message.body).not.toMatch(/evil|800/)
  })

  it('says how many more events this push stands for', () => {
    const base = {
      title: 'Saturday 10K',
      placeLabel: '',
      startMs: la(16, 13),
      timeZone: ZONE,
      peakUV: 8,
      peakAtMs: la(16, 13),
      nowMs: la(16, 10),
    }
    expect(eventHeadsUpMessage({ ...base, more: 1 }).body).toMatch(
      / 1 more of your events coming up reaches high UV too\.$/,
    )
    expect(eventHeadsUpMessage({ ...base, more: 2 }).body).toMatch(
      / 2 more of your events coming up reach high UV too\.$/,
    )
  })
})
