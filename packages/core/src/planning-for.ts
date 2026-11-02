// Whom plans are for, kept apart from the preferences schema (./prefs.ts, which
// re-exports it) so the dashboard can use it without Valibot (ROADMAP item 52).
//
// Shared by the dashboard, the Pro alerts and the calendar feed so they never disagree:
// one person, or a group led by its most sensitive member ("Plan for a group", Pro).

import { mostSensitiveSkinType, type SkinType } from './recommendation'
import type { Profile, UserPreferences } from './prefs'

/** The preferences that decide whom a plan is for. */
export type GroupPreferences = Pick<
  UserPreferences,
  'profiles' | 'skinType' | 'groupMode' | 'groupProfileIds'
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
export function groupMembers(
  prefs: Pick<GroupPreferences, 'profiles' | 'groupProfileIds'>,
): Profile[] {
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
export function planningFor(prefs: GroupPreferences): PlanningFor {
  const members = prefs.groupMode ? groupMembers(prefs) : []
  if (members.length < 2) return { skinType: prefs.skinType, group: null, mostSensitive: null }
  const skinType = mostSensitiveSkinType(members.map(p => p.skinType))!
  const mostSensitive = members.find(p => p.skinType === skinType)!
  return { skinType, group: members, mostSensitive }
}
