import { describe, expect, it } from 'vitest'
import type { Activity } from './types'
import type { PresetCategory } from './tiers'
import {
  activityFromPreset,
  clampDuration,
  customActivity,
  duplicateActivity,
  formatActivityDuration,
  hiddenPresetsFor,
  presetCategoriesFor,
  removeActivity,
  toggleInList,
  updateActivity,
} from './activity-presets'

const CATEGORIES: PresetCategory[] = [
  {
    name: 'Running',
    emoji: '🏃',
    activities: [
      { id: 'run', name: 'Running', icon: '🏃', durationMins: 45, maxUV: 4 },
      { id: 'jog', name: 'Jogging', icon: '🏃', durationMins: 30, maxUV: 5 },
    ],
  },
  {
    name: 'Water',
    emoji: '🌊',
    activities: [{ id: 'swim', name: 'Swimming', icon: '🏊', durationMins: 60, maxUV: 3 }],
  },
]

const run: Activity = {
  id: 'run',
  name: 'Running',
  icon: '🏃',
  durationMins: 45,
  maxUV: 4,
  sunscreen: false,
}
const hike: Activity = { ...run, id: 'hike', name: 'Hiking', durationMins: 120 }

describe('formatActivityDuration', () => {
  it('uses minutes under an hour and hours from an hour up', () => {
    expect(formatActivityDuration(5)).toBe('5m')
    expect(formatActivityDuration(59)).toBe('59m')
    expect(formatActivityDuration(60)).toBe('1h')
    expect(formatActivityDuration(90)).toBe('1.5h')
  })
})

describe('clampDuration', () => {
  it('rounds and never goes below five minutes', () => {
    expect(clampDuration(32.4)).toBe(32)
    expect(clampDuration(0)).toBe(5)
    expect(clampDuration(-20)).toBe(5)
    expect(clampDuration(Number.NaN)).toBe(5)
  })
})

describe('presetCategoriesFor', () => {
  it('drops hidden presets and categories left empty', () => {
    const result = presetCategoriesFor('', ['swim', 'jog'], CATEGORIES)
    expect(result.map(c => c.name)).toEqual(['Running'])
    expect(result[0]?.activities.map(a => a.id)).toEqual(['run'])
  })

  it('searches every category by name, case-insensitively, ignoring spaces around', () => {
    const [results] = presetCategoriesFor('  NING ', [], CATEGORIES)
    expect(results?.name).toBe('Results')
    expect(results?.activities.map(a => a.id)).toEqual(['run'])
    expect(presetCategoriesFor('ing', ['jog'], CATEGORIES)[0]?.activities.map(a => a.id)).toEqual([
      'run',
      'swim',
    ])
  })

  it('treats a blank search as no search', () => {
    expect(presetCategoriesFor('   ', [], CATEGORIES)).toHaveLength(2)
  })
})

describe('hiddenPresetsFor', () => {
  it('lists hidden presets in catalog order with their category', () => {
    expect(hiddenPresetsFor(['swim', 'run', 'missing'], CATEGORIES)).toEqual([
      { ...CATEGORIES[0]!.activities[0], category: 'Running' },
      { ...CATEGORIES[1]!.activities[0], category: 'Water' },
    ])
  })
})

describe('toggleInList', () => {
  it('adds a missing item and removes a present one', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('activity builders', () => {
  it('turns a preset into an activity without sunscreen', () => {
    expect(activityFromPreset(CATEGORIES[0]!.activities[0]!)).toEqual(run)
  })

  it('creates a trimmed custom activity with a time-based id', () => {
    expect(
      customActivity({ name: '  Paddle ', icon: '🛶', durationMins: 2, sunscreen: true }, 42),
    ).toEqual({
      id: 'custom_42',
      name: 'Paddle',
      icon: '🛶',
      durationMins: 5,
      maxUV: 4,
      sunscreen: true,
      custom: true,
    })
  })

  it('duplicates as a custom copy', () => {
    expect(duplicateActivity(run, 7)).toEqual({
      ...run,
      id: 'custom_7',
      name: 'Running copy',
      custom: true,
    })
  })

  it('updates and removes by id without touching the others', () => {
    const list = [run, hike]
    expect(updateActivity(list, 'hike', { sunscreen: true })).toEqual([
      run,
      { ...hike, sunscreen: true },
    ])
    expect(removeActivity(list, 'run')).toEqual([hike])
    expect(list).toEqual([run, hike])
  })
})
