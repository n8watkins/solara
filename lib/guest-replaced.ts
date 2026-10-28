// What a guest is told after signing in to an account that already existed. That
// account keeps its own plan and the guest plan from this browser is dropped
// (lib/session.ts loadAccountPrefs); this records what the guest plan held that the
// account does not, so the app can say so once (components/GuestPlanNotice.tsx).
//
// The record lives in this browser's storage rather than in memory because the sign-in
// that drops the guest plan can finish in a load whose result is superseded by the
// reload that follows sign-in; whichever load drops the plan records it, and the notice
// reads it when the account's dashboard shows. It names its account, is removed once
// shown, and is cleared with the rest of the account's data on sign-out.
import { sameLocation } from '@solara/core'
import { SKIN_TYPE_LABELS } from './profiles'
import type { SkinType, UserPreferences } from './types'

export const GUEST_REPLACED_KEY = 'solara_guest_replaced'

/** The parts of a dropped guest plan that the account does not have. */
export interface ReplacedGuestPlan {
  /** Names of the guest's activities the account does not have. */
  activities: string[]
  /** The guest's place, when the account's is another one. */
  place: string | null
  /** The guest's skin type, when the account's is another one. */
  skinType: SkinType | null
}

interface StoredRecord {
  uid: string
  replaced: ReplacedGuestPlan
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What the guest plan held that `account` does not: activities it lacks (matched by id
 * or name), a different place, a different skin type. Null when there was no guest plan
 * or nothing in it differs, for example when the guest plan just became this account.
 */
export function replacedGuestPlan(
  guest: UserPreferences | null,
  account: UserPreferences,
): ReplacedGuestPlan | null {
  if (!guest) return null
  const activities = guest.activities
    .filter(
      activity =>
        !account.activities.some(
          kept => kept.id === activity.id || sameName(kept.name, activity.name),
        ),
    )
    .map(activity => activity.name)
  const place = sameLocation(guest.location, account.location) ? null : guest.location.city
  const skinType = guest.skinType === account.skinType ? null : guest.skinType
  if (!activities.length && !place && !skinType) return null
  return { activities, place, skinType }
}

/** The lines the notice lists, one per kind of thing the account did not take. */
export function replacedGuestPlanLines(replaced: ReplacedGuestPlan): string[] {
  const lines: string[] = []
  if (replaced.activities.length) {
    const label = replaced.activities.length === 1 ? 'Activity' : 'Activities'
    lines.push(`${label}: ${replaced.activities.join(', ')}`)
  }
  if (replaced.place) lines.push(`Place: ${replaced.place}`)
  if (replaced.skinType) lines.push(`Skin type: ${SKIN_TYPE_LABELS[replaced.skinType]}`)
  return lines
}

/** Records what the dropped guest plan held, for `uid`'s notice. */
export function saveReplacedGuestPlan(uid: string, replaced: ReplacedGuestPlan): void {
  try {
    const record: StoredRecord = { uid, replaced }
    localStorage.setItem(GUEST_REPLACED_KEY, JSON.stringify(record))
  } catch {}
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** `uid`'s recorded notice, or null. A record for another account is never returned. */
export function readReplacedGuestPlan(uid: string): ReplacedGuestPlan | null {
  try {
    const raw = localStorage.getItem(GUEST_REPLACED_KEY)
    if (!raw) return null
    const record = JSON.parse(raw) as Partial<StoredRecord> | null
    const replaced = record?.replaced
    if (record?.uid !== uid || !replaced || !isStringList(replaced.activities)) return null
    return {
      activities: replaced.activities,
      place: typeof replaced.place === 'string' ? replaced.place : null,
      skinType:
        typeof replaced.skinType === 'string' && replaced.skinType in SKIN_TYPE_LABELS
          ? replaced.skinType
          : null,
    }
  } catch {
    return null
  }
}

/** Removes the recorded notice: it has been shown, or its account has left this browser. */
export function clearReplacedGuestPlan(): void {
  try {
    localStorage.removeItem(GUEST_REPLACED_KEY)
  } catch {}
}
