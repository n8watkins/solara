import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_CATEGORIES, PRESET_ACTIVITIES } from './tiers'

// firestore.rules hard-codes the preset ids and category names that clients may store, so
// adding a preset without updating the rules would make hiding or collapsing it fail.
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

function rulesList(functionName: string): string[] {
  const match = rules.match(
    new RegExp(`function ${functionName}\\(\\) \\{\\s*return \\[([^\\]]*)\\]`),
  )
  if (!match?.[1]) throw new Error(`${functionName} not found in firestore.rules`)
  return [...match[1].matchAll(/'([^']*)'/g)].map(m => m[1] ?? '')
}

describe('firestore.rules preset lists', () => {
  it('lists exactly the preset activity ids', () => {
    expect(rulesList('presetActivityIds').sort()).toEqual(PRESET_ACTIVITIES.map(a => a.id).sort())
  })

  it('lists exactly the activity category names', () => {
    expect(rulesList('activityCategoryNames').sort()).toEqual(
      ACTIVITY_CATEGORIES.map(c => c.name).sort(),
    )
  })
})
