import { describe, expect, it } from 'vitest'
import { morningAlertMessage, planUvAlert } from './alerts'
import { dailyBriefing } from './briefing'
import { dailyUvMessage } from './daily-uv'
import {
  PROTECT_FROM_UV,
  protectionUV,
  protectionWindow,
  shadeWindow,
  uvSpanAtOrAbove,
  type ProtectionHour,
} from './protection'
import { formatAlertTime } from './alerts'

// A clear summer day by hour (0-23), and the same day under heavy cloud: the forecast
// UV is 45% of the clear sky's (REVIEW9 QA M1 and M2's probe).
const CLEAR = [
  0, 0, 0, 0, 0, 0, 0, 0.3, 1.2, 2.4, 3.6, 5.2, 6.4, 6.8, 6.1, 4.8, 3.3, 2.0, 0.9, 0.2, 0, 0, 0, 0,
]
const hours = (uv: (clear: number) => number, clearSky = true): ProtectionHour[] =>
  CLEAR.map((clear, hour) => ({
    hour,
    uv: Math.round(uv(clear) * 10) / 10,
    ...(clearSky && { clearSkyUV: clear }),
  }))
const daylight = { from: 6.5, to: 18 + 12 / 60 }

const FIXTURES = {
  'a clear day': hours(uv => uv),
  'a cloudy day (3.1, or 6.8 under a clear sky)': hours(uv => uv * 0.45),
  'a hazy day': hours(uv => uv * 0.9),
  'an older forecast without clear-sky values': hours(uv => uv, false),
  'a very high day': hours(uv => uv * 1.6),
}

const time = (hours: number) => formatAlertTime(hours)
const briefingOf = (hourly: ProtectionHour[], nowHour: number) =>
  dailyBriefing({
    day: { date: '2026-10-29', hourly },
    dayLabel: 'Today',
    nowHour,
    activities: [],
    skinType: 'fair',
    daylight,
  })

describe('one protection window for every surface (REVIEW9 QA M1)', () => {
  for (const [name, hourly] of Object.entries(FIXTURES)) {
    it(`the briefing, the morning alert, the daily UV push and the UV alert agree on ${name}`, () => {
      const window = protectionWindow(hourly, daylight)!
      expect(window).not.toBeNull()
      const span = `${time(window.from)} to ${time(window.to)}`

      // The free daily UV push, sent at 7am.
      const push = dailyUvMessage({ window, city: 'Los Angeles', localHour: 7 })
      expect(push.title).toBe(`☀️ Protect from ${span} today`)

      // The dashboard's briefing (and its share text) at 7am, without activities.
      const briefing = briefingOf(hourly, 7)
      const tipSpan = `from ${time(window.from)}\u00a0to\u00a0${time(window.to)}`
      const shade = shadeWindow(hourly, daylight)
      if (shade) {
        expect(briefing.lines.tip).toContain(
          `from ${time(shade.from)}\u00a0to\u00a0${time(shade.to)}`,
        )
      } else {
        expect(briefing.lines.tip).toContain(tipSpan)
        expect(briefing.text).toContain(span)
      }
      // Its low-UV hours (an hour or longer) end where protection starts or start
      // where it ends.
      expect(briefing.window?.spans.length).toBeGreaterThan(0)
      for (const low of briefing.window?.spans ?? []) {
        expect(low.to === window.from || low.from === window.to).toBe(true)
      }
      // The push quotes the briefing's peak line.
      const [peak, clears] = briefing.lines.peak.split(', or ')
      expect(push.body).toContain(`${peak} in Los Angeles${clears ? `, or ${clears}` : ''}.`)

      // The Pro morning alert is the briefing's text.
      const morning = morningAlertMessage({
        date: '2026-10-29',
        city: 'Los Angeles',
        hourly: hourly.filter(h => h.hour >= 7),
        activities: [],
        skinType: 'fair',
        daylight,
      })
      expect(morning.body).toContain(shade ? `${time(shade.from)} to ${time(shade.to)}` : span)

      // The Pro UV alert at 3 ("moderate") names the same times.
      const alert = planUvAlert(hourly, PROTECT_FROM_UV)!
      expect([alert.from, alert.to]).toEqual([
        uvSpanAtOrAbove(hourly, PROTECT_FROM_UV)!.from,
        uvSpanAtOrAbove(hourly, PROTECT_FROM_UV)!.to,
      ])
      expect(alert.from).toBe(window.from)
    })
  }

  it('gives the times the review found apart as one answer', () => {
    // The briefing said "from 10am to 5pm" while the push said "9:05am to 4:40pm".
    const hourly = FIXTURES['a clear day']
    const briefing = briefingOf(hourly, 6)
    expect(briefing.lines.window).toBe(
      'UV is low from 6:30am\u00a0to\u00a09:05am and 4:40pm\u00a0to\u00a06:12pm',
    )
    expect(briefing.lines.tip).toBe(
      'Use sun protection while UV is moderate or higher, from 9:05am\u00a0to\u00a04:40pm',
    )
    const window = protectionWindow(hourly, daylight)!
    expect(dailyUvMessage({ window, city: 'Los Angeles', localHour: 7 })).toEqual({
      title: '☀️ Protect from 9:05am to 4:40pm today',
      body: 'UV peaks at 6.8 (High) around 1pm in Los Angeles. Sunscreen, a hat and shade while the UV is moderate or higher. Recheck current conditions.',
    })
  })
})

describe('protection leans on the clear sky (REVIEW9 QA M2)', () => {
  const cloudy = FIXTURES['a cloudy day (3.1, or 6.8 under a clear sky)']

  it('judges each hour by its clear-sky UV when the forecast has one', () => {
    expect(protectionUV({ uv: 2.2, clearSkyUV: 5.1 })).toBe(5.1)
    expect(protectionUV({ uv: 2.2 })).toBe(2.2)
    expect(protectionUV({ uv: 2.2, clearSkyUV: null })).toBe(2.2)
    // A clear-sky value below the forecast (rounding) never lowers it.
    expect(protectionUV({ uv: 3.1, clearSkyUV: 3 })).toBe(3.1)
  })

  it('does not relax the advice on a cloudy day, and keeps the cloudy forecast as context', () => {
    const briefing = briefingOf(cloudy, 7)
    expect(briefing.lines.peak).toBe(
      'UV peaks at 3.1 (Moderate) around 1pm, or 6.8 if the sky clears',
    )
    const fully = briefingOf(
      hours(uv => uv * 0.3),
      7,
    )
    expect(fully.lines.peak).toBe('UV peaks at 2.0 (Low) around 1pm, or 6.8 if the sky clears')
    expect(fully.lines.window).toBe('UV stays low the rest of the day unless the sky clears')
    expect(fully.lines.tip).toBe(
      'Use sun protection from 9:05am\u00a0to\u00a04:40pm, as UV can be moderate or higher if the sky clears',
    )
    expect(fully.lines.tip).not.toContain('little sun protection')
  })

  it('still sends the free daily UV push, with the clear-sky peak beside the forecast', () => {
    const overcast = hours(uv => uv * 0.3)
    const window = protectionWindow(overcast, daylight)!
    expect(window.forecastReaches).toBe(false)
    expect(dailyUvMessage({ window, city: 'Los Angeles', localHour: 7 })).toEqual({
      title: '☀️ Protect from 9:05am to 4:40pm today',
      body: 'UV peaks at 2.0 (Low) around 1pm in Los Angeles, or 6.8 if the sky clears. Sunscreen, a hat and shade in case the sky clears. Recheck current conditions.',
    })
  })

  it('still says little protection is needed when even a clear sky stays low', () => {
    const winter = CLEAR.map((clear, hour) => ({
      hour,
      uv: Math.round(clear * 0.2 * 10) / 10,
      clearSkyUV: Math.round(clear * 0.35 * 10) / 10,
    }))
    expect(protectionWindow(winter, daylight)).toBeNull()
    expect(briefingOf(winter, 7).lines.tip).toBe('Most people need little sun protection today')
  })

  it('seeks shade on a clear-sky very high day and says why', () => {
    const veryHigh = CLEAR.map((clear, hour) => ({
      hour,
      uv: Math.round(clear * 0.5 * 10) / 10,
      clearSkyUV: Math.round(clear * 1.6 * 10) / 10,
    }))
    const shade = shadeWindow(veryHigh, daylight)!
    expect(shade.forecastReaches).toBe(false)
    expect(briefingOf(veryHigh, 7).lines.tip).toBe(
      `Seek shade from ${time(shade.from)}\u00a0to\u00a0${time(shade.to)}, as UV can be very high or extreme if the sky clears`,
    )
  })
})
