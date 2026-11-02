// Persisted forecast cache: one entry per location, so switching between saved
// locations (or reopening the app) shows the last forecast at once while a fresh
// one loads (stale-while-revalidate, driven by lib/use-forecast.ts).
//
// localStorage is outside the app's control, so every read is validated: the
// store carries a version, each entry is checked against the shape below, and anything
// that does not match is dropped instead of being cast into the app. The checks are
// written by hand rather than with Valibot, because a guest's first screen reads this
// cache and Valibot stays out of that download (ROADMAP item 52).
import { isPlainRecord } from '@solara/core/plain-record'
import { roundCoordinate } from '@solara/core/coordinates'
import type { ForecastData } from './types'
import { isIsoDate, isValidTimeZone } from './time'

export const CACHE_KEY = 'solara_forecast'
/** Bump when the stored shape changes; older stores are discarded, not migrated. */
export const CACHE_VERSION = 2
/** Keys of earlier, unversioned caches, removed on sight. */
const LEGACY_KEYS = ['solara_weather']
/** Locations kept; the least recently fetched entry is evicted first. */
export const MAX_ENTRIES = 8
/** Entries older than this are dropped: too old to show even while refreshing. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Entry {
  key: string
  data: ForecastData
}

type Hour = ForecastData['days'][number]['hourly'][number]

const isFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isUV = (value: unknown): value is number => isFinite(value) && value >= 0

/**
 * Copies the optional fields of `source` that are present into `target`, or returns
 * false when one present field is neither undefined nor `valid`. Other fields are left
 * out, so nothing outside the stored shape reaches the app.
 */
function copyOptional(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fields: Record<string, (value: unknown) => boolean>,
): boolean {
  for (const [field, valid] of Object.entries(fields)) {
    if (!(field in source)) continue
    const value = source[field]
    if (value !== undefined && !valid(value)) return false
    target[field] = value
  }
  return true
}

const OPTIONAL_HOUR_FIELDS = {
  date: (value: unknown) => typeof value === 'string',
  cloudCover: isFinite,
  clearSkyUV: isUV,
  // Added later without a version bump: optional, so a forecast cached before them still
  // loads (and plans on UV alone until the next refresh).
  rainChance: (value: unknown) => isFinite(value) && value >= 0 && value <= 100,
  feelsC: isFinite,
}

function readHour(raw: unknown): Hour | null {
  if (!isPlainRecord(raw)) return null
  const { hour, uv, tempC, condition } = raw
  if (!(Number.isSafeInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23)) return null
  if (!isUV(uv) || !isFinite(tempC) || typeof condition !== 'string') return null
  const out: Record<string, unknown> = { hour, uv, tempC, condition }
  return copyOptional(raw, out, OPTIONAL_HOUR_FIELDS) ? (out as unknown as Hour) : null
}

function readForecast(raw: unknown): ForecastData | null {
  if (!isPlainRecord(raw)) return null
  const { timezone, fetchedAt, current, days } = raw
  if (!isValidTimeZone(timezone) || !isFinite(fetchedAt)) return null
  if (
    !isPlainRecord(current) ||
    !isUV(current.uv) ||
    !isFinite(current.tempC) ||
    typeof current.condition !== 'string'
  ) {
    return null
  }
  if (!Array.isArray(days)) return null
  const readDays: ForecastData['days'] = []
  for (const day of Array.from(days)) {
    if (!isPlainRecord(day) || !isIsoDate(day.dateStr)) return null
    if (!Array.isArray(day.hourly) || day.hourly.length > 24) return null
    const hourly = Array.from(day.hourly, readHour)
    if (hourly.includes(null)) return null
    readDays.push({ dateStr: day.dateStr, hourly: hourly as Hour[] })
  }
  const out: Record<string, unknown> = {
    timezone,
    fetchedAt,
    current: { uv: current.uv, tempC: current.tempC, condition: current.condition },
    days: readDays,
  }
  return copyOptional(raw, out, { stale: value => value === true })
    ? (out as unknown as ForecastData)
    : null
}

/** A stored entry, or null when it does not have exactly the shape this code writes. */
function readEntry(raw: unknown): Entry | null {
  if (!isPlainRecord(raw) || typeof raw.key !== 'string') return null
  const data = readForecast(raw.data)
  return data && { key: raw.key, data }
}

/** Cache key for a location: coordinates rounded the same way requests round them. */
export function locationKey(lat: number, lon: number): string {
  return `${roundCoordinate(lat)},${roundCoordinate(lon)}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Every valid, unexpired entry. A malformed store or entry is dropped, never thrown. */
function readEntries(now: number): Entry[] {
  const store = storage()
  if (!store) return []
  try {
    for (const key of LEGACY_KEYS) store.removeItem(key)
    const raw = store.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed) || parsed.version !== CACHE_VERSION) return []
    if (!Array.isArray(parsed.entries)) return []
    const entries: Entry[] = []
    for (const candidate of Array.from(parsed.entries)) {
      const entry = readEntry(candidate)
      if (entry && now - entry.data.fetchedAt <= MAX_AGE_MS) entries.push(entry)
    }
    return entries
  } catch {
    return []
  }
}

function writeEntries(entries: Entry[]): void {
  try {
    storage()?.setItem(
      CACHE_KEY,
      JSON.stringify({ version: CACHE_VERSION, entries: entries.slice(0, MAX_ENTRIES) }),
    )
  } catch {
    // Quota or privacy mode: the cache is an optimization, so carry on without it.
  }
}

/**
 * The cached forecast for a location, however stale (up to MAX_AGE_MS), or null.
 * The caller decides whether to refresh it.
 */
export function getCachedForecast(lat: number, lon: number, now = Date.now()): ForecastData | null {
  const key = locationKey(lat, lon)
  return readEntries(now).find(entry => entry.key === key)?.data ?? null
}

/** Store a location's forecast, keeping the most recently fetched MAX_ENTRIES locations. */
export function setCachedForecast(lat: number, lon: number, data: ForecastData): void {
  const key = locationKey(lat, lon)
  const others = readEntries(Date.now()).filter(entry => entry.key !== key)
  const entries = [{ key, data }, ...others].sort((a, b) => b.data.fetchedAt - a.data.fetchedAt)
  writeEntries(entries)
}

/** Forget every cached forecast (sign-out). */
export function clearWeatherCache(): void {
  const store = storage()
  try {
    store?.removeItem(CACHE_KEY)
    for (const key of LEGACY_KEYS) store?.removeItem(key)
  } catch {}
}
