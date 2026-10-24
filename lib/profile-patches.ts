// Preference patches for adding, editing and removing profiles in the header's
// profile switcher (components/ProfileSwitcher.tsx).
import { activeProfile, defaultProfile } from './profiles'
import type { Profile, UserPreferences } from './types'

type ProfilePrefs = Pick<UserPreferences, 'profiles' | 'activeProfileId' | 'skinType'>

/** A blank profile for the "add" form, starting from the live skin type. */
export function newProfileDraft(prefs: ProfilePrefs, now = Date.now()): Profile {
  return { id: `profile_${now.toString(36)}`, name: '', skinType: prefs.skinType, icon: '🧑' }
}

/**
 * Adds `profile`, or replaces the saved profile with the same id. The first
 * time a second profile is created, the implicit "Me" is stored with it.
 * Editing the active profile also updates the live skin type.
 */
export function saveProfilePatch(prefs: ProfilePrefs, profile: Profile): Partial<UserPreferences> {
  const saved = prefs.profiles ?? []
  const base = saved.length ? saved : [defaultProfile(prefs.skinType)]
  const exists = base.some(p => p.id === profile.id)
  const profiles = exists ? base.map(p => (p.id === profile.id ? profile : p)) : [...base, profile]
  const patch: Partial<UserPreferences> = { profiles }
  if (profile.id === activeProfile(prefs).id) patch.skinType = profile.skinType
  return patch
}

/**
 * Removes a saved profile. Removing the active one selects the first profile
 * left and takes its skin type; removing the last one clears the list.
 */
export function removeProfilePatch(prefs: ProfilePrefs, id: string): Partial<UserPreferences> {
  const profiles = (prefs.profiles ?? []).filter(p => p.id !== id)
  const patch: Partial<UserPreferences> = { profiles: profiles.length ? profiles : undefined }
  if (id === activeProfile(prefs).id) {
    const fallback = profiles[0]
    patch.activeProfileId = fallback?.id
    if (fallback) patch.skinType = fallback.skinType
  }
  return patch
}
