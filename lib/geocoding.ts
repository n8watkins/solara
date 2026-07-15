import { Location } from './types'

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

function toLocation(result: GeocodingResult): Location {
  return {
    lat: result.latitude,
    lon: result.longitude,
    city: result.name,
    region: result.admin1 ?? result.country ?? '',
    timezone: result.timezone,
  }
}

function matchesQualifier(result: GeocodingResult, qualifier: string): boolean {
  const normalizedQualifier = qualifier.toLocaleLowerCase()
  return [result.admin1, result.admin2, result.country, result.country_code]
    .filter((value): value is string => Boolean(value))
    .some(value => value.toLocaleLowerCase().includes(normalizedQualifier))
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

  const directResults = await fetchResults(normalized, 1)
  if (directResults[0]) return toLocation(directResults[0])

  const [city, ...qualifierParts] = normalized.split(',').map(part => part.trim()).filter(Boolean)
  if (!city || qualifierParts.length === 0) return null

  const fallbackResults = await fetchResults(city, 10)
  if (fallbackResults.length === 0) return null

  const qualifiers = qualifierParts.map(part => part.toLocaleLowerCase())
  const qualifiedResult = fallbackResults.find(result => qualifiers.every(qualifier => matchesQualifier(result, qualifier)))
  return toLocation(qualifiedResult ?? fallbackResults[0])
}
