import { describe, expect, it } from 'vitest'
import { defaultPrefs } from '@/lib/prefs'
import {
  applySettingsDraft,
  isSettingsDraftDirty,
  planLimitRows,
  settingsDraftFrom,
} from '@/lib/settings'
import type { Location, UserPreferences } from '@/lib/types'

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const SD: Location = { lat: 32.72, lon: -117.16, city: 'San Diego', region: 'CA' }

function prefs(extra: Partial<UserPreferences> = {}): UserPreferences {
  return { ...defaultPrefs(LA), ...extra }
}

describe('settingsDraftFrom', () => {
  it('fills in the defaults for fields that were never saved', () => {
    const p = prefs()
    delete p.showSunPath
    delete p.temperatureUnit
    delete p.clockFormat
    expect(settingsDraftFrom(p)).toEqual({
      skinType: p.skinType,
      location: LA,
      showSunPath: true,
      hiddenActivitySuggestionIds: [],
      collapsedActivityCategories: [],
      notificationHour: 7,
      uvAlertThreshold: 0,
      quietHours: { from: 21, to: 7 },
      eventHeadsUp: true,
      dailyUv: true,
      temperatureUnit: 'auto',
      clockFormat: 'auto',
    })
  })

  it('keeps saved values', () => {
    const draft = settingsDraftFrom(
      prefs({ showSunPath: false, temperatureUnit: 'celsius', notificationHour: 9 }),
    )
    expect(draft.showSunPath).toBe(false)
    expect(draft.temperatureUnit).toBe('celsius')
    expect(draft.notificationHour).toBe(9)
  })

  it('keeps the alert settings', () => {
    const draft = settingsDraftFrom(prefs({ uvAlertThreshold: 6, quietHours: { from: 22, to: 6 } }))
    expect(draft.uvAlertThreshold).toBe(6)
    expect(draft.quietHours).toEqual({ from: 22, to: 6 })
  })

  it('keeps event heads-ups on unless they were turned off', () => {
    expect(settingsDraftFrom(prefs()).eventHeadsUp).toBe(true)
    expect(settingsDraftFrom(prefs({ eventHeadsUp: false })).eventHeadsUp).toBe(false)
    expect(
      isSettingsDraftDirty(prefs(), { ...settingsDraftFrom(prefs()), eventHeadsUp: false }),
    ).toBe(true)
  })
})

describe('isSettingsDraftDirty', () => {
  it('is clean when nothing changed, including unsaved defaults', () => {
    const p = prefs()
    delete p.showSunPath
    expect(isSettingsDraftDirty(p, settingsDraftFrom(p))).toBe(false)
    expect(isSettingsDraftDirty(p, { ...settingsDraftFrom(p), showSunPath: true })).toBe(false)
  })

  it('notices a change to any edited field', () => {
    const p = prefs()
    const draft = settingsDraftFrom(p)
    expect(isSettingsDraftDirty(p, { ...draft, skinType: 'dark' })).toBe(true)
    expect(isSettingsDraftDirty(p, { ...draft, location: SD })).toBe(true)
    expect(isSettingsDraftDirty(p, { ...draft, clockFormat: '24h' })).toBe(true)
    expect(isSettingsDraftDirty(p, { ...draft, hiddenActivitySuggestionIds: ['swim'] })).toBe(true)
    expect(isSettingsDraftDirty(p, { ...draft, uvAlertThreshold: 8 })).toBe(true)
    expect(isSettingsDraftDirty(p, { ...draft, quietHours: { from: 22, to: 7 } })).toBe(true)
  })

  it('is clean again once a change is undone', () => {
    const p = prefs({ skinType: 'fair' })
    const draft = { ...settingsDraftFrom(p), skinType: 'dark' as const }
    expect(isSettingsDraftDirty(p, { ...draft, skinType: 'fair' })).toBe(false)
  })
})

describe('applySettingsDraft', () => {
  it('writes the draft and leaves every other field alone', () => {
    const p = prefs({ tier: 'paid' })
    const saved = applySettingsDraft(p, { ...settingsDraftFrom(p), location: SD })
    expect(saved.location).toEqual(SD)
    expect(saved.tier).toBe('paid')
    expect(saved.activities).toBe(p.activities)
  })
})

describe('planLimitRows', () => {
  it('counts a guest against the one-activity guest plan', () => {
    expect(planLimitRows('anonymous', 0)).toEqual([
      { label: 'Activities', value: '0 / 1' },
      { label: 'Calendar export', value: false },
      { label: '10-day forecast', value: false },
    ])
  })

  it('counts activities against the plan limit', () => {
    expect(planLimitRows('free', 2)[0]).toEqual({ label: 'Activities', value: '2 / 3' })
    expect(planLimitRows('free', 2).slice(1)).toEqual([
      { label: 'Calendar export', value: true },
      { label: '10-day forecast', value: false },
    ])
    expect(planLimitRows('paid', 5).map(row => row.value)).toEqual(['5 / 20', true, true])
  })
})
