import { describe, expect, it } from 'vitest'
import { newProfileDraft, removeProfilePatch, saveProfilePatch } from '@/lib/profile-patches'
import type { Profile } from '@/lib/types'

const me: Profile = { id: 'me', name: 'Me', skinType: 'fair', icon: '🙂' }
const ava: Profile = { id: 'ava', name: 'Ava', skinType: 'very-fair', icon: '👧' }
const rex: Profile = { id: 'rex', name: 'Rex', skinType: 'dark', icon: '🐕' }

describe('newProfileDraft', () => {
  it('starts blank with the live skin type and a time-based id', () => {
    expect(newProfileDraft({ skinType: 'olive' }, 36)).toEqual({
      id: 'profile_10',
      name: '',
      skinType: 'olive',
      icon: '🧑',
    })
  })
})

describe('saveProfilePatch', () => {
  it('stores the implicit "Me" together with the first added profile', () => {
    expect(saveProfilePatch({ skinType: 'medium' }, ava)).toEqual({
      profiles: [{ id: 'me', name: 'Me', skinType: 'medium', icon: '🧑' }, ava],
    })
  })

  it('appends a new profile to the saved list', () => {
    const patch = saveProfilePatch(
      { profiles: [me, ava], activeProfileId: 'me', skinType: 'fair' },
      rex,
    )
    expect(patch).toEqual({ profiles: [me, ava, rex] })
  })

  it('replaces an edited profile in place', () => {
    const renamed = { ...ava, name: 'Ava B' }
    const patch = saveProfilePatch(
      { profiles: [me, ava], activeProfileId: 'me', skinType: 'fair' },
      renamed,
    )
    expect(patch).toEqual({ profiles: [me, renamed] })
  })

  it('updates the live skin type when the active profile changes', () => {
    const darker = { ...me, skinType: 'medium' as const }
    const patch = saveProfilePatch(
      { profiles: [me, ava], activeProfileId: 'me', skinType: 'fair' },
      darker,
    )
    expect(patch).toEqual({ profiles: [darker, ava], skinType: 'medium' })
  })
})

describe('removeProfilePatch', () => {
  it('removes an inactive profile and keeps the selection', () => {
    expect(
      removeProfilePatch({ profiles: [me, ava], activeProfileId: 'me', skinType: 'fair' }, 'ava'),
    ).toEqual({ profiles: [me] })
  })

  it('falls back to the first remaining profile when the active one goes', () => {
    expect(
      removeProfilePatch(
        { profiles: [me, ava], activeProfileId: 'ava', skinType: 'very-fair' },
        'ava',
      ),
    ).toEqual({ profiles: [me], activeProfileId: 'me', skinType: 'fair' })
  })

  it('clears the list when the last profile goes', () => {
    expect(
      removeProfilePatch({ profiles: [ava], activeProfileId: 'ava', skinType: 'very-fair' }, 'ava'),
    ).toEqual({ profiles: undefined, activeProfileId: undefined })
  })
})
