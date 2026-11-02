// A visit: another place this device shows instead of home for a while (ROADMAP item 53),
// and the areas where the person said "Not now" to the travel prompt. Kept only in this
// browser, for the owner who made them (a guest, or one account), and never sent anywhere:
// home and the saved places stay in the plan (prefs.location, prefs.savedLocations), which
// the server reads; a visit never changes them.
//
// In the first load (the header shows a visit from the first frame), so it reads by hand
// rather than through Valibot, and holds only what the opening screen needs; the travel
// prompt and its "Not now" areas (lib/travel-check.ts) load on demand.
import { samePlace } from '@solara/core/coordinates'
import { isPlainRecord } from '@solara/core/plain-record'
import type { NotNowArea } from '@solara/core/travel'
import { isStoredLocation } from './stored-plan'
import type { Location } from './types'

export const TRAVEL_KEY = 'solara_travel'

/** Whose visit it is: an account's uid, or the guest's. */
export type TravelOwner = string

/** The owner of a plan: its account, or the guest (an empty uid). */
export function travelOwner(uid: string | null | undefined): TravelOwner {
  return uid ? `uid:${uid}` : 'guest'
}

/** What this browser keeps for one owner. */
export interface TravelRecord {
  visit: Location | null
  /** Possibly ended; lib/travel-check.ts keeps those still in force. */
  notNow: NotNowArea[]
}

const EMPTY: TravelRecord = Object.freeze({ visit: null, notNow: [] })

function isNotNowArea(value: unknown): value is NotNowArea {
  if (!isPlainRecord(value)) return false
  const { lat, lon, until } = value
  return (
    typeof lat === 'number' &&
    Math.abs(lat) <= 90 &&
    typeof lon === 'number' &&
    Math.abs(lon) <= 180 &&
    typeof until === 'number' &&
    Number.isFinite(until)
  )
}

/** A place as the plan keeps one, with a name to show in the header. */
function isVisit(value: unknown): value is Location {
  return isStoredLocation(value) && (value as Location).city.length > 0
}

function readRecord(): (TravelRecord & { owner: TravelOwner }) | null {
  try {
    const raw = localStorage.getItem(TRAVEL_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed) || typeof parsed.owner !== 'string') return null
    return {
      owner: parsed.owner,
      visit: isVisit(parsed.visit) ? parsed.visit : null,
      notNow: Array.isArray(parsed.notNow) ? parsed.notNow.filter(isNotNowArea) : [],
    }
  } catch {
    return null
  }
}

/** The owner's record, empty when nothing is kept or another owner's is. */
export function readTravel(owner: TravelOwner): TravelRecord {
  const record = readRecord()
  return record?.owner === owner ? { visit: record.visit, notNow: record.notNow } : EMPTY
}

const listeners = new Set<() => void>()

function notify() {
  snapshot = null
  for (const listener of listeners) listener()
}

/** Replaces the owner's record (and any other owner's). */
export function writeTravel(owner: TravelOwner, next: TravelRecord): void {
  try {
    if (!next.visit && next.notNow.length === 0) localStorage.removeItem(TRAVEL_KEY)
    else localStorage.setItem(TRAVEL_KEY, JSON.stringify({ owner, ...next }))
  } catch {}
  notify()
}

/**
 * Shows `place` on this device instead of home, for this owner; home itself (or null)
 * ends the visit.
 */
export function saveVisit(owner: TravelOwner, place: Location | null, home: Location): void {
  const visit = place && !samePlace(place, home) ? place : null
  writeTravel(owner, { ...readTravel(owner), visit })
}

/** Removes every visit and "Not now" area (a sign-out, another account, a deletion). */
export function clearTravel(): void {
  try {
    localStorage.removeItem(TRAVEL_KEY)
  } catch {}
  notify()
}

let snapshot: { owner: TravelOwner; visit: Location | null } | null = null

/**
 * The place this owner is visiting on this device, or null at home: the same object
 * until the stored visit changes, for useSyncExternalStore.
 */
export function visitSnapshot(owner: TravelOwner): Location | null {
  if (snapshot?.owner !== owner) snapshot = { owner, visit: readTravel(owner).visit }
  return snapshot.visit
}

/** For useSyncExternalStore: changes from this tab, and from other tabs. */
export function subscribeTravel(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TRAVEL_KEY && event.key !== null) return
    snapshot = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
