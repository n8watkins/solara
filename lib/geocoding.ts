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
  const normalizedQualifier = qualifier.trim().toLocaleLowerCase()
  const acceptedValues = new Set([normalizedQualifier, REGION_ABBREVIATIONS[normalizedQualifier]])
  return [result.admin1, result.admin2, result.country, result.country_code]
    .filter((value): value is string => Boolean(value))
    .some(value => acceptedValues.has(value.trim().toLocaleLowerCase()))
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

  const [city, ...qualifierParts] = normalized.split(',').map(part => part.trim()).filter(Boolean)
  if (!city) return null

  if (qualifierParts.length === 0) {
    const directResults = await fetchResults(normalized, 1)
    return directResults[0] ? toLocation(directResults[0]) : null
  }

  const qualifiers = qualifierParts.map(part => part.toLocaleLowerCase())
  const findQualifiedResult = (results: GeocodingResult[]) =>
    results.find(result => qualifiers.every(qualifier => matchesQualifier(result, qualifier)))

  const directResult = findQualifiedResult(await fetchResults(normalized, 10))
  if (directResult) return toLocation(directResult)

  const fallbackResults = await fetchResults(city, 10)
  const qualifiedResult = findQualifiedResult(fallbackResults)
  return qualifiedResult ? toLocation(qualifiedResult) : null
}
