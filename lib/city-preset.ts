// The city pages' "See today's UV" link opens the app at /app/?city=<slug>: a visitor
// without a plan starts setup with that city already chosen. Only cities from the
// checked-in list are accepted, so the link cannot put arbitrary text on screen, and
// the list loads only when the link is used (it stays out of a guest's first load).
import type { Location } from './types'

export const CITY_PARAM = 'city'

const SLUG = /^[a-z]+(?:-[a-z]+)*$/

/** The city slug in a query string, or null when absent or malformed. */
export function cityParam(search: string): string | null {
  const slug = new URLSearchParams(search).get(CITY_PARAM)
  return slug && slug.length <= 40 && SLUG.test(slug) ? slug : null
}

interface CityEntry {
  slug: string
  name: string
  region: string
  country: string
  lat: number
  lon: number
  timezone: string
}

/** The place a city slug stands for, as setup would have found it; null for an unknown slug. */
export function cityLocation(cities: readonly CityEntry[], slug: string): Location | null {
  const city = cities.find(c => c.slug === slug)
  if (!city) return null
  return {
    lat: city.lat,
    lon: city.lon,
    city: city.name,
    region: city.region && city.region !== city.name ? city.region : city.country,
    timezone: city.timezone,
  }
}

/** Loads the city list and returns the slug's place (see cityLocation). */
export async function loadCityLocation(slug: string): Promise<Location | null> {
  const { default: cities } = await import('./cities/cities.json')
  return cityLocation(cities, slug)
}
