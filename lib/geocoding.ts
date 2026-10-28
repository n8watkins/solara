import {
  COORDINATE_DECIMALS,
  parseGeocodingResponse,
  parseReverseGeocodeResponse,
  roundCoordinate,
  type GeocodingResult,
} from '@solara/core'
import type { Location } from './types'

const REGION_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ab: 'alberta',
  ak: 'alaska',
  al: 'alabama',
  ar: 'arkansas',
  az: 'arizona',
  bc: 'british columbia',
  ca: 'california',
  co: 'colorado',
  ct: 'connecticut',
  dc: 'district of columbia',
  de: 'delaware',
  fl: 'florida',
  ga: 'georgia',
  hi: 'hawaii',
  ia: 'iowa',
  id: 'idaho',
  il: 'illinois',
  in: 'indiana',
  ks: 'kansas',
  ky: 'kentucky',
  la: 'louisiana',
  ma: 'massachusetts',
  mb: 'manitoba',
  md: 'maryland',
  me: 'maine',
  mi: 'michigan',
  mn: 'minnesota',
  mo: 'missouri',
  ms: 'mississippi',
  mt: 'montana',
  nb: 'new brunswick',
  nc: 'north carolina',
  nd: 'north dakota',
  ne: 'nebraska',
  nh: 'new hampshire',
  nj: 'new jersey',
  nl: 'newfoundland and labrador',
  nm: 'new mexico',
  ns: 'nova scotia',
  nt: 'northwest territories',
  nu: 'nunavut',
  nv: 'nevada',
  ny: 'new york',
  oh: 'ohio',
  ok: 'oklahoma',
  on: 'ontario',
  or: 'oregon',
  pa: 'pennsylvania',
  pe: 'prince edward island',
  qc: 'quebec',
  ri: 'rhode island',
  sc: 'south carolina',
  sd: 'south dakota',
  sk: 'saskatchewan',
  tn: 'tennessee',
  tx: 'texas',
  ut: 'utah',
  va: 'virginia',
  vt: 'vermont',
  wa: 'washington',
  wi: 'wisconsin',
  wv: 'west virginia',
  wy: 'wyoming',
  yt: 'yukon',
}

// Coordinates are rounded to 2 decimals (about 1 km) before they leave the device or
// are stored; the rule lives in @solara/core so the preferences schema applies it too.
export { COORDINATE_DECIMALS, roundCoordinate }

function toLocation(result: GeocodingResult): Location {
  return {
    lat: roundCoordinate(result.latitude),
    lon: roundCoordinate(result.longitude),
    city: result.name,
    region: result.admin1 ?? result.country ?? '',
    timezone: result.timezone,
  }
}

function normalizeLocationPart(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matchesQualifier(result: GeocodingResult, qualifier: string): boolean {
  const normalizedQualifier = normalizeLocationPart(qualifier)
  const acceptedValues = new Set([normalizedQualifier, REGION_ABBREVIATIONS[normalizedQualifier]])
  return [result.admin1, result.admin2, result.country, result.country_code]
    .filter((value): value is string => Boolean(value))
    .some(value => acceptedValues.has(normalizeLocationPart(value)))
}

function abortError(): DOMException {
  return new DOMException('The place search was cancelled', 'AbortError')
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Spaces requests to one service at least `minIntervalMs` apart. A caller takes
 * the next free slot only when it is about to send, so a request cancelled while
 * it waits (the person kept typing) never uses up a slot.
 */
function createRequestSpacer(minIntervalMs: number) {
  let nextRequestAt = 0
  return {
    async waitTurn(signal?: AbortSignal): Promise<void> {
      for (;;) {
        if (signal?.aborted) throw abortError()
        const now = Date.now()
        if (now >= nextRequestAt) {
          nextRequestAt = now + minIntervalMs
          return
        }
        await wait(nextRequestAt - now, signal)
      }
    },
    reset() {
      nextRequestAt = 0
    },
  }
}

/** A small first-in, first-out cache of pending or settled lookups. */
function createLookupCache<T>(limit: number) {
  const entries = new Map<string, Promise<T>>()
  /** Forgets `pending` if it is still the entry for `key`. */
  function forget(key: string, pending: Promise<T>) {
    if (entries.get(key) === pending) entries.delete(key)
  }
  return {
    get: (key: string) => entries.get(key),
    /** Remembers `pending`, and forgets it again if it fails so a later call retries. */
    set(key: string, pending: Promise<T>): Promise<T> {
      entries.set(key, pending)
      if (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      pending.catch(() => forget(key, pending))
      return pending
    },
    forget,
    clear: () => entries.clear(),
  }
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/**
 * The place search proxy's URL when this build uses the forecast proxy
 * (NEXT_PUBLIC_FORECAST_PROXY, fixed at build time), or null. Open-Meteo's free API is
 * non-commercial for geocoding too, so once forecasts come from the commercial plan,
 * place search does as well, through the `placeSearch` Function that holds the key.
 */
function placeSearchProxyUrl(): string | null {
  const functionsUrl = process.env.NEXT_PUBLIC_FUNCTIONS_URL
  return process.env.NEXT_PUBLIC_FORECAST_PROXY === '1' && functionsUrl
    ? `${functionsUrl.replace(/\/$/, '')}/placeSearch`
    : null
}

/** The request for one place search: the proxy with an App Check token, or the free API. */
async function placeSearchRequest(
  query: string,
  count: number,
): Promise<{ url: string; init?: RequestInit }> {
  const proxy = placeSearchProxyUrl()
  if (!proxy) {
    const params = new URLSearchParams({
      name: query,
      count: String(count),
      language: 'en',
      format: 'json',
    })
    return { url: `${GEOCODING_URL}?${params}` }
  }
  // Loaded on demand, as for the forecast proxy (lib/forecast.ts).
  const { appCheckToken } = await import('./firebase')
  const token = await appCheckToken()
  if (!token) throw new Error('Location search unavailable: app verification is not set up')
  const params = new URLSearchParams({ name: query, count: String(count) })
  return { url: `${proxy}?${params}`, init: { headers: { 'X-Firebase-AppCheck': token } } }
}
/**
 * Place search is spaced like the reverse lookup below: at most one request per
 * second from this browser. Typing is debounced before it gets here, and a
 * search cancelled while it waits for its turn is never sent.
 */
export const PLACE_SEARCH_MIN_INTERVAL_MS = 1000
/** How many suggestions a place search offers. */
export const PLACE_SUGGESTION_LIMIT = 5
/** Open-Meteo answers nothing for one character; two match exact names only. */
export const PLACE_SEARCH_MIN_LENGTH = 2
const PLACE_SEARCH_CACHE_LIMIT = 50

const searchSpacer = createRequestSpacer(PLACE_SEARCH_MIN_INTERVAL_MS)
const searchCache = createLookupCache<GeocodingResult[]>(PLACE_SEARCH_CACHE_LIMIT)

/**
 * One Open-Meteo place search, cached per query and count for the session and
 * spaced by {@link PLACE_SEARCH_MIN_INTERVAL_MS}. Concurrent calls for the same
 * query share one request.
 */
async function fetchResults(
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<GeocodingResult[]> {
  const key = `${count}:${normalizeLocationPart(query)}`
  const cached = searchCache.get(key)
  if (cached) return cached
  await searchSpacer.waitTurn(signal)
  // Another caller may have sent the same search while this one waited.
  const sent = searchCache.get(key)
  if (sent) return sent

  return searchCache.set(
    key,
    placeSearchRequest(query, count).then(async ({ url, init }) => {
      const response = await fetch(url, init)
      if (!response.ok) throw new Error(`Location search failed with status ${response.status}`)
      // Results without a usable position or name are dropped; a malformed body throws.
      return parseGeocodingResponse(await response.json())
    }),
  )
}

/** One place the search offers, with the detail that tells same-named places apart. */
export interface PlaceSuggestion {
  location: Location
  /** Region and country, such as "California, United States" (may be empty). */
  detail: string
}

function toSuggestion(result: GeocodingResult): PlaceSuggestion {
  const parts = [result.admin1, result.country].filter((part): part is string => Boolean(part))
  return {
    location: toLocation(result),
    detail: [...new Set(parts)].join(', '),
  }
}

/**
 * Places that match `query`, best first, with coordinates rounded to
 * {@link COORDINATE_DECIMALS} decimals. "City, region" narrows the matches to that
 * region or country (abbreviations such as "CA" work too). Rejects when the
 * search fails, or with an AbortError when `signal` cancels it before it is sent.
 */
export async function searchPlaces(
  query: string,
  { limit = PLACE_SUGGESTION_LIMIT, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<PlaceSuggestion[]> {
  const normalized = query.trim()
  const [city, ...qualifierParts] = normalized
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  if (!city) return []

  const seen = new Set<string>()
  const finish = (results: GeocodingResult[]) =>
    results
      .map(toSuggestion)
      .filter(({ location, detail }) => {
        // Open-Meteo can list one town twice (a city and its district); keep one.
        const key = `${location.city}|${detail}|${location.lat},${location.lon}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit)

  if (qualifierParts.length === 0) {
    return finish(await fetchResults(normalized, limit, signal))
  }

  // Ask for more than we show, because the region filter drops some.
  const qualifiedCount = Math.max(10, limit)
  const qualifiers = qualifierParts.map(part => part.toLocaleLowerCase())
  const qualified = (results: GeocodingResult[]) =>
    results.filter(
      result =>
        normalizeLocationPart(result.name) === normalizeLocationPart(city) &&
        qualifiers.every(qualifier => matchesQualifier(result, qualifier)),
    )

  const direct = qualified(await fetchResults(normalized, qualifiedCount, signal))
  if (direct.length > 0) return finish(direct)
  return finish(qualified(await fetchResults(city, qualifiedCount, signal)))
}

/** The best match for `query`, or null when nothing matches. */
export async function searchLocation(query: string): Promise<Location | null> {
  const [best] = await searchPlaces(query, { limit: 1 })
  return best?.location ?? null
}

export interface PlaceName {
  city: string
  region: string
}

const FALLBACK_PLACE: PlaceName = { city: 'Your location', region: '' }
/** Nominatim's usage policy allows at most one request per second per app. */
export const REVERSE_GEOCODE_MIN_INTERVAL_MS = 1100
const REVERSE_GEOCODE_CACHE_LIMIT = 50

const placeCache = createLookupCache<PlaceName>(REVERSE_GEOCODE_CACHE_LIMIT)
const reverseSpacer = createRequestSpacer(REVERSE_GEOCODE_MIN_INTERVAL_MS)

async function requestPlaceName(lat: number, lon: number): Promise<PlaceName> {
  // Space requests out instead of firing one per click, per the usage policy.
  await reverseSpacer.waitTurn()

  const params = new URLSearchParams({
    lat: lat.toFixed(COORDINATE_DECIMALS),
    lon: lon.toFixed(COORDINATE_DECIMALS),
    format: 'json',
    // City-level detail only; we never need a street address.
    zoom: '10',
    'accept-language': 'en',
  })
  // Nominatim asks every app to identify itself. A browser cannot set User-Agent,
  // so the request names the site through its Referer (the origin only), whatever
  // referrer policy the page itself uses.
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    referrerPolicy: 'strict-origin',
  })
  if (!response.ok) throw new Error(`Reverse geocoding failed with status ${response.status}`)
  const address = parseReverseGeocodeResponse(await response.json())
  return {
    city:
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      FALLBACK_PLACE.city,
    region: address.state || address.country || '',
  }
}

/**
 * Turn coordinates into a city and region with OpenStreetMap Nominatim.
 *
 * The one shared helper for every "use my location" button: coordinates are
 * rounded first, results are cached per rounded position for the session,
 * concurrent calls share one request, and requests are spaced at least
 * {@link REVERSE_GEOCODE_MIN_INTERVAL_MS} apart. Failures resolve to a generic
 * "Your location" label and are not cached, so a later attempt can retry.
 */
export function reverseGeocode(lat: number, lon: number): Promise<PlaceName> {
  const roundedLat = roundCoordinate(lat)
  const roundedLon = roundCoordinate(lon)
  const key = `${roundedLat},${roundedLon}`
  const cached = placeCache.get(key)
  if (cached) return cached
  const pending: Promise<PlaceName> = requestPlaceName(roundedLat, roundedLon).catch(() => {
    placeCache.forget(key, pending)
    return FALLBACK_PLACE
  })
  return placeCache.set(key, pending)
}

/**
 * Build a {@link Location} from a device position: rounded coordinates, a place
 * name from {@link reverseGeocode}, and the device time zone.
 */
export async function locationFromCoordinates(lat: number, lon: number): Promise<Location> {
  const place = await reverseGeocode(lat, lon)
  return {
    lat: roundCoordinate(lat),
    lon: roundCoordinate(lon),
    ...place,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/** Test hook: forget cached place names and the request spacing. */
export function resetReverseGeocodeCache(): void {
  placeCache.clear()
  reverseSpacer.reset()
}

/** Test hook: forget cached place searches and the request spacing. */
export function resetPlaceSearchCache(): void {
  searchCache.clear()
  searchSpacer.reset()
}
