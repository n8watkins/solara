// The city pages (app/uv/): a curated list of cities with their typical UV by month,
// and the words each page says about it. Everything comes from the checked-in
// lib/cities/ data (scripts/city-climatology.mjs), so the pages build with no
// network and no API key.
import { formatUV, uvBand, uvLabel, type UVBand } from './weather'
import cityList from './cities/cities.json'
import climatology from './cities/uv-climatology.json'

export interface City {
  slug: string
  name: string
  /** State, province or region. */
  region: string
  country: string
  lat: number
  lon: number
  /** IANA zone, so the app shows the city's own clock. */
  timezone: string
}

/** One month's typical UV, averaged over every day of that month in the source years. */
export interface MonthUV {
  /** The day's highest UV index, with clouds. */
  peak: number
  /** The day's highest UV index under a clear sky. */
  clearSky: number
  /** Hours a day with a UV index of 3 or more. */
  hours3: number
  /** On days that reach UV 3: the median first hour, and the hour after the last; null when most days do not. */
  from: number | null
  to: number | null
  /** Days averaged. */
  days: number
}

export const CITIES: readonly City[] = cityList

const DATA = climatology.cities as Record<string, { elevation: number; months: MonthUV[] }>

/** The source line every city page credits. */
export const CLIMATOLOGY_SOURCE = {
  years: climatology.years,
  first: climatology.years[0]!,
  last: climatology.years.at(-1)!,
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** The city page's path, with the trailing slash the export uses. */
export function cityPath(slug: string): string {
  return `/uv/${slug}/`
}

/** The app, opened on setup with the city already chosen (lib/city-preset.ts). */
export function cityAppHref(slug: string): string {
  return `/app/?city=${encodeURIComponent(slug)}`
}

export function cityBySlug(slug: string): City | null {
  return CITIES.find(city => city.slug === slug) ?? null
}

/** "Los Angeles, California" or, where the region repeats the name, "Tokyo, Japan". */
export function cityPlace(city: City): string {
  const area = city.region && city.region !== city.name ? city.region : city.country
  return area === city.name ? city.name : `${city.name}, ${area}`
}

/** "9am", "12pm", "6pm". */
export function hourText(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

/** Whole-number UV, as the UV index scale is read (for thresholds, never for display). */
const index = (uv: number) => Math.round(uv)

/** "June", "June and July", "May, June and July". */
function list(names: readonly string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The months flagged true, as words: "from October to March" when they run on
 * (wrapping past December), "in June and July" or a list otherwise; "all year" for
 * every month and null for none.
 */
export function monthSpan(flags: readonly boolean[]): string | null {
  const count = flags.filter(Boolean).length
  if (count === 0) return null
  if (count === 12) return 'all year'
  // A run starts at a flagged month that follows an unflagged one.
  const start = flags.findIndex((flag, i) => flag && !flags[(i + 11) % 12])
  if (count === 1) return `in ${MONTHS[start]}`
  let end = start
  while (flags[(end + 1) % 12]) end = (end + 1) % 12
  if ((end - start + 12) % 12 === count - 1) {
    return count === 2
      ? `in ${MONTHS[start]} and ${MONTHS[end]}`
      : `from ${MONTHS[start]} to ${MONTHS[end]}`
  }
  return `in ${list(MONTHS.filter((_, i) => flags[i]))}`
}

export interface CityMonth extends MonthUV {
  month: (typeof MONTHS)[number]
  band: UVBand
  label: string
}

export interface CityPage {
  city: City
  place: string
  elevation: number
  months: CityMonth[]
  /** The month with the highest typical peak. */
  top: CityMonth
  /** Facts about this city, one sentence each. */
  facts: string[]
  /** Other cities to link to: the same country first, then the nearest. */
  related: City[]
}

/** Great-circle distance in km, for "nearby" links. */
function distanceKm(a: City, b: City): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Up to `count` other cities: the same country first, nearest first, then the nearest elsewhere. */
export function relatedCities(city: City, count = 6): City[] {
  const others = CITIES.filter(c => c.slug !== city.slug).sort(
    (a, b) =>
      Number(b.country === city.country) - Number(a.country === city.country) ||
      distanceKm(city, a) - distanceKm(city, b),
  )
  return others.slice(0, count)
}

export function cityPage(slug: string): CityPage | null {
  const city = cityBySlug(slug)
  const data = DATA[slug]
  if (!city || !data) return null
  const months: CityMonth[] = data.months.map((m, i) => ({
    ...m,
    month: MONTHS[i]!,
    band: uvBand(m.peak),
    label: uvLabel(m.peak),
  }))
  const top = months.reduce((best, m) => (m.peak > best.peak ? m : best), months[0]!)
  const reaches3 = months.map(m => index(m.peak) >= 3)
  const season = monthSpan(reaches3)
  const lowSpan = monthSpan(reaches3.map(reached => !reached))
  const facts: string[] = [
    `UV in ${city.name} is highest in ${top.month}, when a typical day peaks around ${formatUV(top.peak)} (${top.label}).`,
  ]
  if (top.from !== null && top.to !== null) {
    facts.push(
      `On a typical ${top.month} day, UV is 3 or more from about ${hourText(top.from)} to ${hourText(top.to)}, about ${Math.round(top.hours3)} hours.`,
    )
  }
  if (season) {
    facts.push(
      season === 'all year'
        ? 'The typical midday UV reaches 3 or more in every month, so sun protection is a year-round habit here.'
        : `The typical midday UV reaches 3 or more ${season}, when public-health guidance recommends sun protection.`,
    )
  }
  if (lowSpan) facts.push(`UV usually stays under 3 ${lowSpan}.`)
  const cloudiest = months.reduce((best, m) =>
    m.clearSky - m.peak > best.clearSky - best.peak ? m : best,
  )
  if (index(cloudiest.clearSky) - index(cloudiest.peak) >= 1) {
    facts.push(
      `Clouds take the most off in ${cloudiest.month}: a typical peak of ${formatUV(cloudiest.peak)}, against ${formatUV(cloudiest.clearSky)} under a clear sky. On a clear day, expect the higher number.`,
    )
  }
  if (data.elevation >= 1000) {
    facts.push(
      `At about ${(Math.round(data.elevation / 10) * 10).toLocaleString('en-US')} m above sea level, UV here runs higher than on the coast: roughly 10% more for every 1,000 m.`,
    )
  }
  return {
    city,
    place: cityPlace(city),
    elevation: data.elevation,
    months,
    top,
    facts,
    related: relatedCities(city),
  }
}

/** The page's meta description: unique per city, under about 160 characters. */
export function cityDescription(page: CityPage): string {
  return `Typical UV index in ${page.place} by month: UV peaks around ${formatUV(page.top.peak)} in ${page.top.month}. See when UV is 3 or more and today's forecast.`
}

/** Cities grouped by country, countries and cities in alphabetical order, for the index page. */
export function citiesByCountry(): { country: string; cities: City[] }[] {
  const groups = new Map<string, City[]>()
  for (const city of CITIES) groups.set(city.country, [...(groups.get(city.country) ?? []), city])
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([country, cities]) => ({
      country,
      cities: cities.sort((a, b) => a.name.localeCompare(b.name)),
    }))
}
