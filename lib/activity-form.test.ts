import { describe, expect, it } from 'vitest'
import type { Activity } from './types'
import {
  activityForm,
  activityFromForm,
  clampUV,
  daysSummary,
  normalizedDays,
  normalizedHours,
} from './activity-form'
import { activityEdited } from './activity-draft'

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 45,
  maxUV: 4,
  sunscreen: false,
}

describe('activityForm', () => {
  it('fills defaults for fields the activity leaves out', () => {
    expect(activityForm(run)).toEqual({
      name: 'Running',
      icon: '🏃',
      durationMins: 45,
      sunscreen: false,
      maxUV: 4,
      preferredEnabled: false,
      preferredFrom: 6,
      preferredTo: 20,
      timePreference: 'earliest',
      days: [],
      cloudSensitive: false,
    })
  })

  it('round-trips an untouched activity without looking edited', () => {
    const full: Activity = {
      ...run,
      preferredHours: { from: 7, to: 9 },
      timePreference: 'sunniest',
      daysOfWeek: [6, 0],
      cloudSensitive: true,
    }
    for (const activity of [run, full]) {
      expect(activityEdited(activity, activityFromForm(activity, activityForm(activity)))).toBe(
        false,
      )
    }
  })
})

describe('activityFromForm', () => {
  it('stores defaults as absent and normalizes what was typed', () => {
    const draft = activityFromForm(run, {
      ...activityForm(run),
      name: '   ',
      durationMins: Number.NaN,
      maxUV: 12.34,
      preferredEnabled: true,
      preferredFrom: 22.6,
      preferredTo: 3,
      days: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(draft).toMatchObject({
      name: 'Running',
      durationMins: 5,
      maxUV: 11,
      preferredHours: { from: 23, to: 24 },
      timePreference: undefined,
      daysOfWeek: undefined,
      cloudSensitive: undefined,
    })
  })

  it('keeps real choices', () => {
    const draft = activityFromForm(run, {
      ...activityForm(run),
      name: ' Trail run ',
      timePreference: 'latest',
      days: [5, 1],
      cloudSensitive: true,
      sunscreen: true,
    })
    expect(draft).toMatchObject({
      name: 'Trail run',
      timePreference: 'latest',
      daysOfWeek: [1, 5],
      cloudSensitive: true,
      sunscreen: true,
    })
  })
})

describe('field normalizers', () => {
  it('clamps the UV limit to 0-11 in tenths', () => {
    expect(clampUV(-1)).toBe(0)
    expect(clampUV(4.26)).toBe(4.3)
    expect(clampUV(Number.NaN)).toBe(0)
  })

  it('keeps preferred hours a non-empty range', () => {
    expect(normalizedHours(6, 20)).toEqual({ from: 6, to: 20 })
    expect(normalizedHours(10, 10)).toEqual({ from: 10, to: 11 })
    expect(normalizedHours(-3, 30)).toEqual({ from: 0, to: 24 })
  })

  it('treats no days and all days as every day', () => {
    expect(normalizedDays([])).toBeUndefined()
    expect(normalizedDays([0, 1, 2, 3, 4, 5, 6])).toBeUndefined()
    expect(normalizedDays([3, 1])).toEqual([1, 3])
    expect(daysSummary([])).toBe('Every day')
    expect(daysSummary([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(daysSummary([2])).toBe('1 day')
    expect(daysSummary([1, 2, 3, 4, 5])).toBe('5 days')
  })
})
