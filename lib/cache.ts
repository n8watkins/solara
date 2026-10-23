// Persisted forecast cache: one entry per location, so switching between saved
// locations (or reopening the app) shows the last forecast at once while a fresh
// one loads (stale-while-revalidate, driven by lib/use-forecast.ts).
//
// localStorage is outside the app's control, so every read is validated: the
// store carries a version, each entry is checked against a schema, and anything
// that does not match is dropped instead of being cast into the app.
import * as z from 'zod/mini'
import type { ForecastData } from './types'
import { roundCoordinate } from './geocoding'
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

const finite = z.number()
const hourSchema = z.object({
  date: z.optional(z.string()),
  hour: z.int().check(z.gte(0), z.lte(23)),
  uv: finite.check(z.gte(0)),
  tempC: finite,
  condition: z.string(),
  cloudCover: z.optional(finite),
})

const forecastSchema = z.object({
  timezone: z.string().check(z.refine(isValidTimeZone)),
  fetchedAt: finite,
  current: z.object({ uv: finite.check(z.gte(0)), tempC: finite, condition: z.string() }),
  days: z.array(
    z.object({
      dateStr: z.string().check(z.refine(isIsoDate)),
      hourly: z.array(hourSchema).check(z.maxLength(24)),
    }),
  ),
})

const entrySchema = z.object({ key: z.string(), data: forecastSchema })
type Entry = z.infer<typeof entrySchema>

const storeSchema = z.object({
  version: z.literal(CACHE_VERSION),
  entries: z.array(z.unknown()),
})

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
    const parsed = storeSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    const entries: Entry[] = []
    for (const candidate of parsed.data.entries) {
      const entry = entrySchema.safeParse(candidate)
      if (entry.success && now - entry.data.data.fetchedAt <= MAX_AGE_MS) entries.push(entry.data)
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
