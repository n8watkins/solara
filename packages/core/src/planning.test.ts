import { describe, expect, it } from 'vitest'
import {
  dailyBriefing,
  exposureFactor,
  groupMembers,
  parsePlanningPreferences,
  planningFor,
  PREFS_LIMITS,
} from '@solara/core'

const parent = { id: 'me', name: 'Me', skinType: 'dark' as const }
const child = { id: 'kid', name: 'Kid', skinType: 'very-fair' as const }

describe('planningFor', () => {
  it('plans a group by its most sensitive person (REVIEW3 M5 example)', () => {
    // A family in group mode: the dark-skinned parent is the active profile, so the live
    // skin type is theirs, but the plan is for the very fair child.
    const prefs = { skinType: 'dark' as const, profiles: [parent, child], groupMode: true }
    const planning = planningFor(prefs)
    expect(planning.skinType).toBe('very-fair')
    expect(planning.mostSensitive?.id).toBe('kid')
    expect(planning.group?.map(p => p.id)).toEqual(['me', 'kid'])
  })

  it('uses the live skin type outside group mode or with fewer than two in the group', () => {
    expect(planningFor({ skinType: 'dark', profiles: [parent, child] }).skinType).toBe('dark')
    expect(
      planningFor({
        skinType: 'dark',
        profiles: [parent, child],
        groupMode: true,
        groupProfileIds: ['me'],
      }).skinType,
    ).toBe('dark')
  })

  it('keeps the group to the ticked profiles', () => {
    expect(
      groupMembers({ profiles: [parent, child], groupProfileIds: ['kid'] }).map(p => p.id),
    ).toEqual(['kid'])
    expect(groupMembers({ profiles: [parent, child] })).toHaveLength(2)
  })
})

describe('parsePlanningPreferences', () => {
  it('reads a stored account the way the app does', () => {
    const planning = parsePlanningPreferences({
      skinType: 'dark',
      profiles: [parent, child, { name: 'no skin type' }],
      groupMode: true,
      activities: [{ id: 'run', name: 'Run', icon: '🏃', maxUV: 3, durationMins: 60 }],
      tier: 'paid',
      stripeCustomerId: 'cus_1',
    })
    expect(planning.profiles).toEqual([parent, child])
    expect(planningFor(planning).skinType).toBe('very-fair')
    expect(planning.activities).toEqual([
      { id: 'run', name: 'Run', icon: '🏃', maxUV: 3, durationMins: 60, sunscreen: false },
    ])
    expect(planning).not.toHaveProperty('stripeCustomerId')
  })

  it('falls back to the defaults for fields the rules leave untyped (REVIEW3 L4)', () => {
    const planning = parsePlanningPreferences({
      skinType: 'purple',
      profiles: 'everyone',
      groupMode: 'yes',
      activities: [
        { id: 'a', name: 'Walk', shade: 'toString', surface: 'constructor', maxUV: 'high' },
        { id: 'b', name: 'Swim', icon: '🏊'.repeat(500) },
        'not an activity',
        { name: 'No id' },
      ],
    })
    expect(planning.skinType).toBe('fair')
    expect(planning.profiles).toBeUndefined()
    expect(planning.groupMode).toBeUndefined()
    const [walk, swim, ...rest] = planning.activities
    expect(walk).toMatchObject({ id: 'a', shade: undefined, surface: undefined, maxUV: 4 })
    expect(exposureFactor(walk!)).toBe(1)
    // An icon longer than any emoji falls back to the default, so a push stays small.
    expect(swim?.icon).toBe('☀️')
    expect(rest).toHaveLength(1)
  })

  it('migrates a version 1 document like the app', () => {
    const planning = parsePlanningPreferences({
      sunscreen: true,
      activities: [{ id: 'run', name: 'Run', maxUV: 5 }],
    })
    expect(planning.activities[0]?.sunscreen).toBe(true)
  })

  it('reads anything that is not a document as an empty plan', () => {
    for (const raw of [undefined, null, 'x', []]) {
      expect(parsePlanningPreferences(raw)).toMatchObject({ skinType: 'fair', activities: [] })
    }
  })

  it('caps icons at the scheduled-record limit', () => {
    expect(PREFS_LIMITS.iconLength).toBe(16)
  })
})

describe('the briefing for a group', () => {
  it('gives the most sensitive burn time, as the dashboard does', () => {
    const planning = planningFor({
      skinType: 'dark',
      profiles: [parent, child],
      groupMode: true,
    })
    const briefing = (skinType: typeof planning.skinType) =>
      dailyBriefing({
        day: {
          date: '2026-06-15',
          hourly: [
            { hour: 12, uv: 8 },
            { hour: 13, uv: 8 },
          ],
        },
        dayLabel: 'Today',
        activities: [],
        skinType,
        formatTime: h => `${h}`,
      }).text
    expect(briefing(planning.skinType)).toMatch(/burn in about 13 min/)
    expect(briefing('dark')).toMatch(/burn in about 63 min/)
  })
})
