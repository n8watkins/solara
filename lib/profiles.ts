import { mostSensitiveSkinType } from '@solara/core'
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

type GroupPrefs = Pick<
  UserPreferences,
  'profiles' | 'activeProfileId' | 'skinType' | 'groupMode' | 'groupProfileIds'
>

/** Who plans and burn estimates are for: one person, or a group led by its most sensitive. */
export interface PlanningFor {
  /** The skin type every estimate uses. */
  skinType: SkinType
  /** In group mode, the people in the group (two or more); otherwise null. */
  group: Profile[] | null
  /** In group mode, the person whose skin type is used. */
  mostSensitive: Profile | null
}

/** The saved profiles in the group: those named in `groupProfileIds`, or all when unset. */
export function groupMembers(prefs: GroupPrefs): Profile[] {
  const saved = prefs.profiles ?? []
  if (!prefs.groupProfileIds) return saved
  const ids = new Set(prefs.groupProfileIds)
  return saved.filter(p => ids.has(p.id))
}

/**
 * Whom the plans are for. In group mode with two or more people in the group, the most
 * sensitive of them (lightest skin type, see mostSensitiveSkinType) sets the skin type,
 * so a plan that suits them suits everyone; ties go to the first in the list. Otherwise
 * the live skin type (the active profile's) is used.
 *
 * Group mode is turned on only on Pro (components/ProfileSwitcher.tsx), but it keeps
 * applying if the account goes back to Free with its profiles: it only ever makes the
 * estimates more cautious.
 */
export function planningFor(prefs: GroupPrefs): PlanningFor {
  const members = prefs.groupMode ? groupMembers(prefs) : []
  if (members.length < 2) return { skinType: prefs.skinType, group: null, mostSensitive: null }
  const skinType = mostSensitiveSkinType(members.map(p => p.skinType))!
  const mostSensitive = members.find(p => p.skinType === skinType)!
  return { skinType, group: members, mostSensitive }
}

/** The skin type plans and burn estimates use (see planningFor). */
export function planningSkinType(prefs: GroupPrefs): SkinType {
  return planningFor(prefs).skinType
}

/**
 * The patch for adding or removing a profile from the group. The selection is stored
 * explicitly from the first change on, starting from everyone.
 */
export function toggleGroupMemberPatch(
  prefs: GroupPrefs,
  id: string,
): Pick<UserPreferences, 'groupProfileIds'> {
  const current = groupMembers(prefs).map(p => p.id)
  const next = current.includes(id) ? current.filter(m => m !== id) : [...current, id]
  return { groupProfileIds: next }
}
