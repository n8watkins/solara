import { describe, it, expect } from 'vitest'
import {
  defaultProfile,
  activeProfile,
  selectProfile,
  toggleGroupMemberPatch,
} from '@/lib/profiles'
import { groupMembers, mostSensitiveSkinType, planningFor } from '@solara/core'
import { normalizePrefs } from '@/lib/prefs'
import type { Location, Profile } from '@/lib/types'

const LA: Location = { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'CA' }
const ava: Profile = { id: 'ava', name: 'Ava', skinType: 'very-fair', icon: '👧' }
const rex: Profile = { id: 'rex', name: 'Rex', skinType: 'dark', icon: '🐕' }

describe('profile helpers', () => {
  it('falls back to an implicit "Me" from skinType when no profiles', () => {
    const p = activeProfile({ profiles: undefined, activeProfileId: undefined, skinType: 'medium' })
    expect(p).toEqual(defaultProfile('medium'))
    expect(p.skinType).toBe('medium')
  })

  it('resolves the active profile by id, else first', () => {
    expect(
      activeProfile({ profiles: [ava, rex], activeProfileId: 'rex', skinType: 'fair' }).id,
    ).toBe('rex')
    expect(
      activeProfile({ profiles: [ava, rex], activeProfileId: 'missing', skinType: 'fair' }).id,
    ).toBe('ava')
  })

  it('selectProfile mirrors skin type into the live field', () => {
    expect(selectProfile(ava)).toEqual({ activeProfileId: 'ava', skinType: 'very-fair' })
  })
})

describe('normalizePrefs — profiles', () => {
  const base = (extra: Record<string, unknown>) => normalizePrefs({ location: LA, ...extra })!

  it('drops invalid profiles and dedupes by id', () => {
    const r = base({
      profiles: [ava, { name: 'NoSkin' }, { id: 'ava', name: 'Dup', skinType: 'fair' }, 5],
    })
    expect(r.profiles).toHaveLength(1)
    expect(r.profiles![0]!.id).toBe('ava')
  })

  it('leaves profiles undefined when none are valid', () => {
    expect(base({ profiles: [] }).profiles).toBeUndefined()
    expect(base({ profiles: [{ name: 'x' }] }).profiles).toBeUndefined()
  })

  it('keeps activeProfileId only when it matches a real profile', () => {
    expect(base({ profiles: [ava], activeProfileId: 'ava' }).activeProfileId).toBe('ava')
    expect(base({ profiles: [ava], activeProfileId: 'ghost' }).activeProfileId).toBeUndefined()
  })
})

describe('planning for a group', () => {
  const me: Profile = { id: 'me', name: 'Me', skinType: 'medium' }
  const base = { profiles: [me, ava, rex], activeProfileId: 'me', skinType: 'medium' as const }

  it('picks the skin type that burns fastest', () => {
    expect(mostSensitiveSkinType(['dark', 'medium', 'fair'])).toBe('fair')
    expect(mostSensitiveSkinType(['olive'])).toBe('olive')
    expect(mostSensitiveSkinType([])).toBeNull()
  })

  it('uses the live skin type when group mode is off', () => {
    expect(planningFor(base)).toEqual({ skinType: 'medium', group: null, mostSensitive: null })
    expect(planningFor({ ...base, groupMode: false }).skinType).toBe('medium')
  })

  it('uses the most sensitive person among everyone by default', () => {
    const planning = planningFor({ ...base, groupMode: true })
    expect(planning.skinType).toBe('very-fair')
    expect(planning.mostSensitive?.name).toBe('Ava')
    expect(planning.group?.map(p => p.id)).toEqual(['me', 'ava', 'rex'])
  })

  it('uses only the people in the group, ignoring removed profiles', () => {
    const planning = planningFor({
      ...base,
      groupMode: true,
      groupProfileIds: ['me', 'rex', 'gone'],
    })
    expect(planning).toMatchObject({ skinType: 'medium', mostSensitive: { id: 'me' } })
  })

  it('needs two people in the group', () => {
    expect(planningFor({ ...base, groupMode: true, groupProfileIds: ['rex'] }).skinType).toBe(
      'medium',
    )
    expect(planningFor({ ...base, profiles: undefined, groupMode: true }).skinType).toBe('medium')
  })

  it('ties go to the first person listed', () => {
    const twin: Profile = { id: 'twin', name: 'Twin', skinType: 'very-fair' }
    expect(
      planningFor({ ...base, profiles: [me, ava, twin], groupMode: true }).mostSensitive?.id,
    ).toBe('ava')
  })

  it('toggles a person in and out, starting from everyone', () => {
    expect(groupMembers(base).map(p => p.id)).toEqual(['me', 'ava', 'rex'])
    expect(toggleGroupMemberPatch(base, 'ava')).toEqual({ groupProfileIds: ['me', 'rex'] })
    expect(toggleGroupMemberPatch({ ...base, groupProfileIds: ['me'] }, 'rex')).toEqual({
      groupProfileIds: ['me', 'rex'],
    })
  })

  it('keeps the group fields through normalization, cleaned', () => {
    const prefs = normalizePrefs({
      location: LA,
      profiles: [ava, rex],
      groupMode: true,
      groupProfileIds: ['ava', 'ava', '', 7, 'x'.repeat(65), 'rex'],
    })
    expect(prefs).toMatchObject({ groupMode: true, groupProfileIds: ['ava', 'rex'] })
    expect(
      normalizePrefs({ location: LA, groupMode: 'yes', groupProfileIds: 'ava' }),
    ).toMatchObject({
      groupMode: undefined,
      groupProfileIds: undefined,
    })
  })
})
