import { beforeEach, describe, expect, it } from 'vitest'
import { defaultPrefs } from '@/lib/prefs'
import {
  GUEST_REPLACED_KEY,
  clearReplacedGuestPlan,
  readReplacedGuestPlan,
  replacedGuestPlan,
  replacedGuestPlanLines,
  saveReplacedGuestPlan,
} from '@/lib/guest-replaced'
import type { Activity, Location, UserPreferences } from '@/lib/types'

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const BOSTON: Location = { lat: 42.36, lon: -71.06, city: 'Boston', region: 'MA' }
const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 45,
  maxUV: 4,
  sunscreen: false,
}
const hike: Activity = {
  id: 'hike',
  name: 'Hiking',
  icon: '🥾',
  durationMins: 120,
  maxUV: 3,
  sunscreen: false,
}

function plan(patch: Partial<UserPreferences>): UserPreferences {
  return { ...defaultPrefs(LA), ...patch }
}

describe('replacedGuestPlan', () => {
  it('is null without a guest plan', () => {
    expect(replacedGuestPlan(null, plan({}))).toBeNull()
  })

  it('is null when the account holds everything the guest plan did', () => {
    const guest = plan({ activities: [run], skinType: 'olive' })
    expect(
      replacedGuestPlan(guest, plan({ activities: [hike, run], skinType: 'olive' })),
    ).toBeNull()
  })

  it('names the activities, place and skin type the account does not have', () => {
    const guest = plan({ location: BOSTON, activities: [run], skinType: 'olive' })
    expect(replacedGuestPlan(guest, plan({ activities: [hike] }))).toEqual({
      activities: ['Running'],
      place: 'Boston',
      skinType: 'olive',
    })
  })

  it('matches activities by name as well as id', () => {
    const custom = { ...run, id: 'custom_1', name: ' running ' }
    expect(
      replacedGuestPlan(plan({ activities: [custom] }), plan({ activities: [run] })),
    ).toBeNull()
  })

  it('treats nearby coordinates as the same place', () => {
    const near = { ...LA, lat: 34.051, city: 'LA' }
    expect(replacedGuestPlan(plan({ location: near }), plan({}))).toBeNull()
  })
})

describe('replacedGuestPlanLines', () => {
  it('lists one line per kind, in plain words', () => {
    expect(
      replacedGuestPlanLines({
        activities: ['Running', 'Hiking'],
        place: 'Boston',
        skinType: 'very-fair',
      }),
    ).toEqual(['Activities: Running, Hiking', 'Place: Boston', 'Skin type: Very fair'])
    expect(
      replacedGuestPlanLines({ activities: ['Running'], place: null, skinType: null }),
    ).toEqual(['Activity: Running'])
  })
})

describe('the stored notice', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    })
  })

  it('is read back only for its own account', () => {
    const replaced = { activities: ['Running'], place: null, skinType: null }
    saveReplacedGuestPlan('user-a', replaced)
    expect(readReplacedGuestPlan('user-a')).toEqual(replaced)
    expect(readReplacedGuestPlan('user-b')).toBeNull()
    clearReplacedGuestPlan()
    expect(readReplacedGuestPlan('user-a')).toBeNull()
  })

  it('ignores a damaged record', () => {
    storage.set(GUEST_REPLACED_KEY, '{not json')
    expect(readReplacedGuestPlan('user-a')).toBeNull()
    storage.set(GUEST_REPLACED_KEY, JSON.stringify({ uid: 'user-a', replaced: { activities: 3 } }))
    expect(readReplacedGuestPlan('user-a')).toBeNull()
    storage.set(
      GUEST_REPLACED_KEY,
      JSON.stringify({ uid: 'user-a', replaced: { activities: [], place: 4, skinType: 'blue' } }),
    )
    expect(readReplacedGuestPlan('user-a')).toEqual({ activities: [], place: null, skinType: null })
  })
})
