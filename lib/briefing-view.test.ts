import { describe, expect, it } from 'vitest'
import type { Activity, HourlyForecast, WeatherResponse } from './types'
import { briefingView, type BriefingViewInput } from './briefing-view'
import { formatClockTime } from './units'

const UV = [0, 0.6, 2, 3.9, 6, 8, 9.5, 10.3, 10, 9.3, 7.7, 5.5, 3.1, 1.1, 0]
const hours = (scale = 1): HourlyForecast[] =>
  UV.map((uv, i) => ({
    hour: 6 + i,
    uv: Math.round(uv * scale * 10) / 10,
    tempC: 20,
    condition: 'Clear',
  }))

const weather = {
  now: { date: '2026-06-15', hour: 10, minute: 30 },
  today: hours(),
  tomorrow: hours(0.9),
} as unknown as Pick<WeatherResponse, 'now' | 'today' | 'tomorrow'>

const run = { id: 'run', name: 'Running', icon: '🏃', durationMins: 45, maxUV: 4 } as Activity

function view(overrides: Partial<BriefingViewInput> = {}) {
  return briefingView({
    weather,
    selectedDay: null,
    nowHour: 10.5,
    activities: [run],
    skinType: 'fair',
    laterDaysVisible: true,
    city: 'Los Angeles',
    formatTime: h => formatClockTime(h),
    ...overrides,
  })
}

describe('briefingView', () => {
  it('briefs the rest of today by day', () => {
    const v = view()
    expect(v.heading).toBe('Today at a glance')
    expect(v.briefing.date).toBe('2026-06-15')
    expect(v.briefing.lines.window).toBe('Best lower-UV window: Running 6pm–8pm')
    expect(v.locked).toBe(false)
    expect(v.shareText).toMatch(
      /^Today in Los Angeles: UV peaks at 10.3 \(Very high\) around 1pm\./,
    )
  })

  it('briefs tomorrow after dark', () => {
    const v = view({ nowHour: 21.5 })
    expect(v.heading).toBe('Tomorrow at a glance')
    expect(v.briefing.date).toBe('2026-06-16')
    expect(v.briefing.lines.peak).toBe('UV peaks at 9.3 (Very high) around 1pm')
    expect(v.shareText).toMatch(/^Tomorrow in Los Angeles: /)
  })

  it('offers sign-in instead of tomorrow on the guest plan', () => {
    expect(view({ nowHour: 21.5, laterDaysVisible: false }).locked).toBe(true)
    // By day a guest sees today in full.
    expect(view({ laterDaysVisible: false }).locked).toBe(false)
  })

  it('briefs a picked later day as a whole day', () => {
    const v = view({
      selectedDay: { dateStr: '2026-06-17', label: 'Wed, Jun 17', hourly: hours(0.5) },
    })
    expect(v.heading).toBe('Wed, Jun 17 at a glance')
    expect(v.briefing.peak?.passed).toBe(false)
    expect(v.briefing.lines.window).toBe('Best lower-UV window: Running 6am–12pm')
  })

  it('leaves the place out of the share text when it is unknown', () => {
    expect(view({ city: '' }).shareText).toMatch(/^Today: /)
  })
})
