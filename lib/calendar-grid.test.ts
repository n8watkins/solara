import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledActivity } from '@solara/core'
import {
  AXIS_PAD,
  NO_DATA_BG,
  ROW_H,
  axisBodyHeight,
  axisHours,
  calendarDays,
  durationText,
  hasUVGaps,
  holdsScheduled,
  nowMarker,
  planCalendarDays,
  scheduledBlock,
  scheduledDetail,
  uvRowBg,
  windowBlock,
  windowSlot,
} from './calendar-grid'
import { nowHourOf } from './next-slot'
import { buildPrefs, buildWeather } from '@/tests/harness/fixtures'
import { HARNESS_DATE, HARNESS_NOW, HARNESS_TIMEZONE } from '@/tests/harness/clock'

const axis = { from: 6, to: 20 }

describe('axis geometry', () => {
  it('lists every hour line, first to last', () => {
    expect(axisHours({ from: 6, to: 9 })).toEqual([6, 7, 8, 9])
  })

  it('keeps at least one row for an empty axis', () => {
    expect(axisHours({ from: 8, to: 8 })).toEqual([8, 9])
    expect(axisBodyHeight({ from: 8, to: 8 })).toBe(ROW_H + AXIS_PAD * 2)
  })

  it('sizes the body to the rows plus the padding', () => {
    expect(axisBodyHeight(axis)).toBe(14 * ROW_H + 2 * AXIS_PAD)
  })
})

describe('windowBlock', () => {
  it('places a window inside the axis with a 1 px inset', () => {
    expect(windowBlock(8, 10, axis)).toEqual({
      top: 2 * ROW_H + 1,
      height: 2 * ROW_H - 2,
      cutTop: false,
      cutBottom: false,
      lines: Math.floor((2 * ROW_H - 2 - 6) / 13),
    })
  })

  it('clips a window that runs past the axis and squares the cut ends', () => {
    const block = windowBlock(5, 21, axis)
    expect(block).toMatchObject({ top: 1, height: 14 * ROW_H - 2, cutTop: true, cutBottom: true })
  })

  it('returns null when nothing of the window is shown', () => {
    expect(windowBlock(20, 22, axis)).toBeNull()
    expect(windowBlock(3, 6, axis)).toBeNull()
  })
})

describe('scheduledBlock', () => {
  it('is at least 20 px tall so a short activity still shows its check', () => {
    const block = scheduledBlock(10, 10.25, axis)
    expect(block?.height).toBe(20)
    expect(block?.lines).toBe(1)
  })

  it('uses the full span when it is taller', () => {
    expect(scheduledBlock(18, 18.75, axis)).toMatchObject({
      top: 12 * ROW_H + 1,
      height: 0.75 * ROW_H - 2,
    })
  })

  it('returns null off the axis', () => {
    expect(scheduledBlock(21, 22, axis)).toBeNull()
  })
})

describe('nowMarker', () => {
  it('fades the past and draws the line at now', () => {
    expect(nowMarker(10.5, axis)).toEqual({
      pastHeight: AXIS_PAD + 4.5 * ROW_H,
      lineTop: AXIS_PAD + 4.5 * ROW_H - 1,
    })
  })

  it('shows nothing before the axis starts', () => {
    expect(nowMarker(5, axis)).toEqual({ pastHeight: null, lineTop: null })
  })

  it('fades the whole column after the axis ends, without a line', () => {
    expect(nowMarker(22, axis)).toEqual({ pastHeight: AXIS_PAD + 14 * ROW_H, lineTop: null })
  })
})

describe('row colors and copy', () => {
  it('hatches hours without UV data', () => {
    expect(uvRowBg(undefined)).toBe(NO_DATA_BG)
  })

  it('tints by UV band, lighter for no sun', () => {
    expect(uvRowBg(1)).toBe('rgba(74,222,128,0.11)')
    expect(uvRowBg(0)).toBe(`rgba(156,163,175,${0.11 * 0.4})`)
  })

  it('reads durations in minutes or hours', () => {
    expect(durationText(45)).toBe('45 min')
    expect(durationText(60)).toBe('1 hr')
    expect(durationText(90)).toBe('1.5 hr')
  })

  it('finds UV gaps only inside the shown hours', () => {
    const hourly = [7, 8, 9].map(hour => ({ hour, uv: 2, tempC: 20, condition: 'Clear' }))
    expect(hasUVGaps([{ hourly }], { from: 7, to: 10 })).toBe(false)
    expect(hasUVGaps([{ hourly }], { from: 6, to: 10 })).toBe(true)
  })
})

describe('holdsScheduled', () => {
  const span = (from: number, to: number) => ({ span: { from, to } })

  it('is true when a scheduled span overlaps the window', () => {
    expect(holdsScheduled({ from: 18, to: 20 }, [span(18, 18.75)])).toBe(true)
  })

  it('is false when the span only touches an edge', () => {
    expect(holdsScheduled({ from: 18, to: 20 }, [span(17, 18), span(20, 21)])).toBe(false)
  })
})

describe('with the harness forecast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(HARNESS_NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels today and the following weekdays, up to the limit', () => {
    const days = calendarDays(buildWeather(), 3)
    expect(days.map(d => [d.dateStr, d.shortLabel, d.isToday])).toEqual([
      [HARNESS_DATE, 'Today', true],
      ['2026-06-16', 'Tue', false],
      ['2026-06-17', 'Wed', false],
    ])
  })

  it('gives each day its peak, cloud effect and confidence', () => {
    const days = calendarDays(buildWeather(), 10)
    expect(days.map(d => d.confidence)).toEqual([
      ...Array(3).fill('high'),
      ...Array(3).fill('fair'),
      ...Array(4).fill('low'),
    ])
    // Day 3 of the fixture is 92% overcast: UV 4 with clouds, 6 under a clear sky.
    // Day 3 of the fixture is 92% overcast: UV 4.1 with clouds, 6.3 under a clear sky.
    expect(days[3]).toMatchObject({ peakUV: 4.1, cloud: { uv: 4.1, clearSky: 6.3 } })
    // A nearly clear day has nothing worth telling. Its peak is the forecast's 10.3, as
    // the dashboard writes it, not a rounded 10 (REVIEW4 L5).
    expect(days[0]).toMatchObject({ peakUV: 10.3, cloud: null })
  })

  it('plans a lane per activity and leaves out days an activity does not run', () => {
    const weather = buildWeather()
    const prefs = buildPrefs()
    const days = calendarDays(weather, 3)
    const plans = planCalendarDays(days, prefs.activities, {
      skinType: prefs.skinType,
      colorFor: act => `color-${act.id}`,
      scheduledItems: [],
      timeZone: HARNESS_TIMEZONE,
      todayNowHour: nowHourOf(weather.now),
    })
    expect(plans).toHaveLength(3)
    expect(plans[0]?.lanes.map(l => l.act.id)).toEqual(['run', 'hike', 'tennis', 'garden'])
    expect(plans[0]?.lanes[0]?.color).toBe('color-run')
    // Gardening runs on Sun, Mon, Wed and Sat: not on Tuesday.
    expect(plans[1]?.lanes[3]?.windows).toEqual([])
    // Today's windows never start before now.
    for (const lane of plans[0]?.lanes ?? [])
      for (const win of lane.windows) expect(win.from).toBeGreaterThanOrEqual(10.5)
  })

  it('books a slot inside the window and gives the open item its windows', () => {
    const weather = buildWeather()
    const prefs = buildPrefs()
    const days = calendarDays(weather, 3)
    const todayNowHour = nowHourOf(weather.now)
    const plans = planCalendarDays(days, prefs.activities, {
      skinType: prefs.skinType,
      colorFor: () => '#000',
      scheduledItems: [],
      timeZone: HARNESS_TIMEZONE,
      todayNowHour,
    })
    const lane = plans[0]?.lanes[0]
    const win = lane?.windows[0]
    if (!lane || !win || !days[0]) throw new Error('fixture has a running window today')
    const slot = windowSlot(lane.act, win, days[0])
    expect(slot?.start).toBeGreaterThanOrEqual(win.from)
    expect(slot?.end).toBeLessThanOrEqual(win.to)

    const item = {
      eventId: 'e1',
      activityId: 'run',
      start: '2026-06-16T01:00:00.000Z',
      end: '2026-06-16T01:45:00.000Z',
    } as ScheduledActivity
    const detail = scheduledDetail(item, prefs.activities, days, {
      skinType: prefs.skinType,
      timeZone: HARNESS_TIMEZONE,
      todayNowHour,
    })
    expect(detail.dateStr).toBe(HARNESS_DATE)
    expect(detail.activity?.id).toBe('run')
    expect(detail.windows).toEqual(lane.windows)

    const orphan = scheduledDetail({ ...item, activityId: 'gone' }, prefs.activities, days, {
      skinType: prefs.skinType,
      timeZone: HARNESS_TIMEZONE,
      todayNowHour,
    })
    expect(orphan.activity).toBeUndefined()
    expect(orphan.windows).toEqual([])
  })
})
