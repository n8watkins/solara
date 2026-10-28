import { groupMembers, type GroupPreferences } from '@solara/core'
import type { Profile, SkinType, UserPreferences } from './types'

export const SKIN_TYPE_LABELS: Record<SkinType, string> = {
  'very-fair': 'Very fair',
  fair: 'Fair',
  medium: 'Medium',
  olive: 'Olive',
  dark: 'Dark',
}

/** The implicit "Me" profile seeded from the current skin type when none are saved. */
export function defaultProfile(skinType: SkinType): Profile {
  return { id: 'me', name: 'Me', skinType, icon: '🧑' }
}

/**
 * The currently-selected profile. Falls back to the first saved profile, then to an
 * implicit "Me" seeded from the live skinType — so callers always get something.
 */
export function activeProfile(
  prefs: Pick<UserPreferences, 'profiles' | 'activeProfileId' | 'skinType'>,
): Profile {
  const list = prefs.profiles ?? []
  const byId = prefs.activeProfileId ? list.find(p => p.id === prefs.activeProfileId) : undefined
  return byId ?? list[0] ?? defaultProfile(prefs.skinType)
}

/**
 * Produce the prefs patch for switching to a profile: select it AND mirror its skin
 * type into the live `skinType` field that all window math reads.
 */
export function selectProfile(
  profile: Profile,
): Pick<UserPreferences, 'activeProfileId' | 'skinType'> {
  return { activeProfileId: profile.id, skinType: profile.skinType }
}

// Whom plans are for (planningFor, groupMembers) lives in @solara/core (prefs.ts), so
// the Pro alerts and the calendar feed plan exactly as the app.

/**
 * The patch for adding or removing a profile from the group. The selection is stored
 * explicitly from the first change on, starting from everyone.
 */
export function toggleGroupMemberPatch(
  prefs: GroupPreferences,
  id: string,
): Pick<UserPreferences, 'groupProfileIds'> {
  const current = groupMembers(prefs).map(p => p.id)
  const next = current.includes(id) ? current.filter(m => m !== id) : [...current, id]
  return { groupProfileIds: next }
}
