import { describe, expect, it } from 'vitest'
import {
  activityBadge,
  bestWindowLabel,
  isRecommendationScheduled,
  matchTone,
} from './activity-card-view'

const slot = { start: 16, end: 18 } as never

describe('activityBadge', () => {
  it('describes the recommendation, never a passed window', () => {
    expect(activityBadge({ startsNow: true, slot, elapsed: false }, true)).toEqual({
      status: 'safe',
      label: 'Now',
    })
    expect(activityBadge({ startsNow: false, slot, elapsed: false }, true).label).toBe('Later')
    expect(activityBadge({ startsNow: false, slot, elapsed: false }, false).label).toBe('Available')
    expect(activityBadge({ startsNow: false, slot: null, elapsed: true }, true)).toEqual({
      status: 'done',
      label: 'Done for today',
    })
    expect(activityBadge({ startsNow: false, slot: null, elapsed: false }, true).label).toBe(
      'No match',
    )
  })
})

describe('bestWindowLabel', () => {
  const time = (h: number) => `${h}:00`
  it('shows the range, or why there is none', () => {
    const win = { from: 16, to: 18 } as never
    expect(bestWindowLabel({ bestWindow: win, elapsed: false }, true, time)).toBe('16:00–18:00')
    expect(bestWindowLabel({ bestWindow: null, elapsed: true }, true, time)).toBe('None left today')
    expect(bestWindowLabel({ bestWindow: null, elapsed: false }, true, time)).toBe('None today')
    expect(bestWindowLabel({ bestWindow: null, elapsed: false }, false, time)).toBe('None')
  })
})

describe('matchTone', () => {
  it('turns green at 60% and amber at 30%', () => {
    expect([0, 29, 30, 59, 60, 100].map(matchTone)).toEqual([
      'danger',
      'danger',
      'warning',
      'warning',
      'success',
      'success',
    ])
  })
})

describe('isRecommendationScheduled', () => {
  it('is true only when a scheduled event overlaps the slot', () => {
    const rec = { start: 16, end: 18 }
    expect(isRecommendationScheduled(null, [{ span: { from: 16, to: 18 } }])).toBe(false)
    expect(isRecommendationScheduled(rec, [])).toBe(false)
    expect(isRecommendationScheduled(rec, [{ span: { from: 18, to: 19 } }])).toBe(false)
    expect(isRecommendationScheduled(rec, [{ span: { from: 17.5, to: 19 } }])).toBe(true)
  })
})
