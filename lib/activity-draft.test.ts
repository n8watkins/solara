import { describe, expect, it } from 'vitest'
import type { Activity } from './types'
import { activityEdited } from './activity-draft'

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 45,
  maxUV: 4,
  sunscreen: false,
  timePreference: 'earliest',
}

describe('activityEdited', () => {
  it('treats stored defaults and their absent draft form as equal', () => {
    const draft: Activity = { ...run, timePreference: undefined, cloudSensitive: undefined }
    expect(activityEdited(run, draft)).toBe(false)
    expect(activityEdited({ ...run, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, run)).toBe(false)
    expect(activityEdited({ ...run, daysOfWeek: [] }, run)).toBe(false)
    expect(activityEdited({ ...run, cloudSensitive: false }, run)).toBe(false)
  })

  it('ignores the order days were picked in', () => {
    expect(activityEdited({ ...run, daysOfWeek: [5, 1] }, { ...run, daysOfWeek: [1, 5] })).toBe(
      false,
    )
  })

  it('detects real edits', () => {
    expect(activityEdited(run, { ...run, name: 'Jogging' })).toBe(true)
    expect(activityEdited(run, { ...run, timePreference: 'latest' })).toBe(true)
    expect(activityEdited(run, { ...run, daysOfWeek: [0, 6] })).toBe(true)
    expect(activityEdited(run, { ...run, cloudSensitive: true })).toBe(true)
    expect(activityEdited(run, { ...run, preferredHours: { from: 6, to: 9 } })).toBe(true)
  })
})
