import { COORDINATE_DECIMALS, roundCoordinate } from '@solara/core'
import type { Location } from './types'

interface GeocodingResult {
  latitude: number
  longitude: number
  name: string
  admin1?: string
  admin2?: string
  country?: string
  country_code?: string
  timezone?: string
}

interface GeocodingResponse {
  results?: GeocodingResult[]
}

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

async function fetchResults(query: string, count: number): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    name: query,
    count: String(count),
    language: 'en',
    format: 'json',
  })
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  if (!response.ok) throw new Error(`Location search failed with status ${response.status}`)
  const data = (await response.json()) as GeocodingResponse
  return data.results ?? []
}

export async function searchLocation(query: string): Promise<Location | null> {
  const normalized = query.trim()
  if (!normalized) return null

  const [city, ...qualifierParts] = normalized
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  if (!city) return null

  if (qualifierParts.length === 0) {
    const directResults = await fetchResults(normalized, 1)
    return directResults[0] ? toLocation(directResults[0]) : null
  }

  const qualifiers = qualifierParts.map(part => part.toLocaleLowerCase())
  const findQualifiedResult = (results: GeocodingResult[]) =>
    results.find(
      result =>
        normalizeLocationPart(result.name) === normalizeLocationPart(city) &&
        qualifiers.every(qualifier => matchesQualifier(result, qualifier)),
    )

  const directResult = findQualifiedResult(await fetchResults(normalized, 10))
  if (directResult) return toLocation(directResult)

  const fallbackResults = await fetchResults(city, 10)
  const qualifiedResult = findQualifiedResult(fallbackResults)
  return qualifiedResult ? toLocation(qualifiedResult) : null
}

interface ReverseGeocodeResponse {
  address?: {
    city?: string
    town?: string
    village?: string
    municipality?: string
    state?: string
    country?: string
  }
}

export interface PlaceName {
  city: string
  region: string
}

const FALLBACK_PLACE: PlaceName = { city: 'Your location', region: '' }
/** Nominatim's usage policy allows at most one request per second per app. */
export const REVERSE_GEOCODE_MIN_INTERVAL_MS = 1100
const REVERSE_GEOCODE_CACHE_LIMIT = 50

const placeCache = new Map<string, Promise<PlaceName>>()
let nextRequestAt = 0

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function requestPlaceName(lat: number, lon: number): Promise<PlaceName> {
  // Space requests out instead of firing one per click, per the usage policy.
  const now = Date.now()
  const startAt = Math.max(now, nextRequestAt)
  nextRequestAt = startAt + REVERSE_GEOCODE_MIN_INTERVAL_MS
  if (startAt > now) await wait(startAt - now)

  const params = new URLSearchParams({
    lat: lat.toFixed(COORDINATE_DECIMALS),
    lon: lon.toFixed(COORDINATE_DECIMALS),
    format: 'json',
    // City-level detail only; we never need a street address.
    zoom: '10',
    'accept-language': 'en',
  })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`)
  if (!response.ok) throw new Error(`Reverse geocoding failed with status ${response.status}`)
  const data = (await response.json()) as ReverseGeocodeResponse
  const address = data.address ?? {}
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

  const pending = requestPlaceName(roundedLat, roundedLon).catch(() => {
    placeCache.delete(key)
    return FALLBACK_PLACE
  })
  placeCache.set(key, pending)
  if (placeCache.size > REVERSE_GEOCODE_CACHE_LIMIT) {
    const oldest = placeCache.keys().next().value
    if (oldest !== undefined) placeCache.delete(oldest)
  }
  return pending
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
  nextRequestAt = 0
}
