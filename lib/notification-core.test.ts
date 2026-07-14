import { describe, expect, it } from 'vitest'

const {
  buildMessage,
  isDue,
  isEligibleUser,
  localParts,
  mapLimit,
  notificationKey,
  runsOnDate,
} = require('../scripts/notification-core')

const hourly = [
  { hour: 6, uv: 1 },
  { hour: 7, uv: 2 },
  { hour: 8, uv: 5 },
]

describe('notification scheduling', () => {
  it('evaluates the configured morning hour in the user timezone', () => {
    const now = new Date('2026-07-14T14:15:00Z')
    expect(isDue({ notificationHour: 7 }, 'America/Los_Angeles', now)).toBe(true)
    expect(isDue({ notificationHour: 7 }, 'Pacific/Honolulu', now)).toBe(false)
    expect(notificationKey('America/Los_Angeles', now)).toBe('daily-v2:2026-07-14')
  })

  it('uses the location weekday instead of the runner weekday', () => {
    const now = new Date('2026-07-14T01:00:00Z')
    const losAngeles = localParts(now, 'America/Los_Angeles')
    const tokyo = localParts(now, 'Asia/Tokyo')
    expect(losAngeles?.date).toBe('2026-07-13')
    expect(tokyo?.date).toBe('2026-07-14')
    expect(losAngeles?.weekday).not.toBe(tokyo?.weekday)
  })

  it('respects activity weekday restrictions', () => {
    expect(runsOnDate({ daysOfWeek: [1, 3] }, '2026-07-13')).toBe(true)
    expect(runsOnDate({ daysOfWeek: [1, 3] }, '2026-07-14')).toBe(false)
    expect(runsOnDate({}, '2026-07-14')).toBe(true)
  })

  it('requires a paid user with a complete location', () => {
    expect(isEligibleUser({ tier: 'free', location: { lat: 1, lon: 2 } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1 } })).toBe(false)
    expect(isEligibleUser({ tier: 'paid', location: { lat: 1, lon: 2 } })).toBe(true)
  })
})

describe('notification content', () => {
  it('builds qualified lower-UV planning copy', () => {
    const message = buildMessage({
      location: { city: 'Los Angeles' },
      skinType: 'fair',
      activities: [{ id: 'walk', name: 'Walk', icon: '🚶', maxUV: 2, durationMins: 30, sunscreen: false }],
    }, hourly, '2026-07-14')
    expect(message.title).toContain('Walk')
    expect(message.body).toContain('Estimated lower-UV window')
    expect(message.body).toContain('Check current conditions')
  })

  it('does not select an activity that is excluded on the local weekday', () => {
    const message = buildMessage({
      location: { city: 'Los Angeles' },
      activities: [{ id: 'walk', name: 'Walk', icon: '🚶', maxUV: 2, durationMins: 30, sunscreen: false, daysOfWeek: [1] }],
    }, hourly, '2026-07-14')
    expect(message.title).toContain('UV planning update')
  })
})

describe('bounded concurrency', () => {
  it('never runs more workers than the configured limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value: number) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return value * 2
    })
    expect(peak).toBe(2)
    expect(results.map((result: { value: number }) => result.value)).toEqual([2, 4, 6, 8, 10])
  })
})
