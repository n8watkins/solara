import { describe, expect, it } from 'vitest'
import { ACTIVITY_CATEGORY_NAMES, PRESET_ACTIVITY_IDS } from './preset-names'
import { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES } from './presets'

describe('preset names', () => {
  it("are the catalog's ids and category names, in order", () => {
    expect(PRESET_ACTIVITY_IDS).toEqual(PRESET_ACTIVITIES.map(preset => preset.id))
    expect(ACTIVITY_CATEGORY_NAMES).toEqual(ACTIVITY_CATEGORIES.map(category => category.name))
  })
})
