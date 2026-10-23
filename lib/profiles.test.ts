import { describe, it, expect } from 'vitest'
import { defaultProfile, activeProfile, selectProfile } from '@/lib/profiles'
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
