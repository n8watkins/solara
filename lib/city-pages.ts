// The city pages (app/uv/): a curated list of cities with their typical UV by month,
// and the words each page says about it. Everything comes from the checked-in
// lib/cities/ data (scripts/city-climatology.mjs), so the pages build with no
// network and no API key.
//
// The words are in the active language: a Spanish page builds its data inside
// inPageLanguage('es', ...) (lib/page-language.ts), and the city, region and country
// names follow it (lib/cities/names.ts).
import { formatClock12 } from '@solara/core/clock'
import { currentLocale, formatNumber } from '@solara/core/i18n'
import core from '@solara/core/messages/core'
import m from '@/messages/city-pages'
import { formatUV, uvBand, uvLabel, type UVBand } from './weather'
import cityList from './cities/cities.json'
import { CITY_NAMES, COUNTRY_NAMES } from './cities/names'
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
  /** Hours a day with a UV index of 3 or more (2.5 or more, Moderate or higher). */
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

/** The month names in the active language, January first. */
export function monthNames(): string[] {
  return m.months.split(',')
}

/** The short month names in the active language ("Jan", "ene"). */
export function shortMonthNames(): string[] {
  return m.monthsShort.split(',')
}

/** A word with its first letter in upper case, for a month that starts a line. */
export function capitalized(word: string): string {
  return word.charAt(0).toLocaleUpperCase() + word.slice(1)
}

/** The city page's path, with the trailing slash the export uses (lib/page-language.ts adds /es). */
export function cityPath(slug: string): string {
  return `/uv/${slug}/`
}

/** The app, opened on setup with the city already chosen (lib/city-preset.ts). */
export function cityAppHref(slug: string): string {
  return `/app/?city=${encodeURIComponent(slug)}`
}

export function cityBySlug(slug: string): City | null {
  const city = CITIES.find(c => c.slug === slug)
  return city ? localCity(city) : null
}

/** The city with its name, region and country in the active language. */
export function localCity(city: City): City {
  const locale = currentLocale()
  const names = CITY_NAMES[locale]?.[city.slug]
  return {
    ...city,
    name: names?.name ?? city.name,
    region: names?.region ?? city.region,
    country: COUNTRY_NAMES[locale]?.[city.country] ?? city.country,
  }
}

/** "Los Angeles, California" or, where the region repeats the name, "Tokyo, Japan". */
export function cityPlace(city: City): string {
  const area = city.region && city.region !== city.name ? city.region : city.country
  return area === city.name ? city.name : `${city.name}, ${area}`
}

/** "9am", "12pm", "6pm" ("9 a.m." in Spanish). */
export function hourText(hour: number): string {
  return formatClock12(((hour % 24) + 24) % 24)
}

/** Whole-number UV, as the UV index scale is read (for thresholds, never for display). */
const index = (uv: number) => Math.round(uv)

/**
 * The months flagged true, as words: "from October to March" when they run on
 * (wrapping past December), "in June and July" or a list otherwise; "all year" for
 * every month and null for none.
 */
export function monthSpan(flags: readonly boolean[]): string | null {
  const count = flags.filter(Boolean).length
  if (count === 0) return null
  if (count === 12) return m.allYear
  const months = monthNames()
  // A run starts at a flagged month that follows an unflagged one.
  const start = flags.findIndex((flag, i) => flag && !flags[(i + 11) % 12])
  if (count === 1) return m.inMonth(months[start]!)
  let end = start
  while (flags[(end + 1) % 12]) end = (end + 1) % 12
  if ((end - start + 12) % 12 === count - 1) {
    return count === 2
      ? m.inMonths(core.listAnd([months[start]!, months[end]!]))
      : m.fromMonthTo(months[start]!, months[end]!)
  }
  return m.inMonths(core.listAnd(months.filter((_, i) => flags[i])))
}

export interface CityMonth extends MonthUV {
  /** The month's name in the active language, as a sentence uses it ("June", "junio"). */
  month: string
  /** Its short name ("Jun", "jun"). */
  short: string
  band: UVBand
  /** The WHO category of its typical peak. */
  label: string
  /** The typical peak and clear-sky peak, written as the app writes UV. */
  peakText: string
  clearSkyText: string
  /**
   * When UV is usually moderate or higher ("10am" to "3pm"), or null when the month's
   * typical peak is Low: the hours and the category come from the same typical day, so a
   * "Low" month never lists moderate hours (REVIEW10 N9).
   */
  hours: { from: string; to: string } | null
  /**
   * A Low month in which more than half the days still reach UV 3 (a typical peak just
   * under 2.5): its hours column says "Some days" rather than "Rarely".
   */
  someDays: boolean
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
  /** The page's title and meta description. */
  title: string
  description: string
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
  // Countries compare by their English names, whichever language `city` is in.
  const country = CITIES.find(c => c.slug === city.slug)?.country ?? city.country
  const others = CITIES.filter(c => c.slug !== city.slug).sort(
    (a, b) =>
      Number(b.country === country) - Number(a.country === country) ||
      distanceKm(city, a) - distanceKm(city, b),
  )
  return others.slice(0, count)
}

/** A city's page in the active language, or null for an unknown city. */
export function cityPage(slug: string): CityPage | null {
  const city = cityBySlug(slug)
  const data = DATA[slug]
  if (!city || !data) return null
  const names = monthNames()
  const shorts = shortMonthNames()
  const months: CityMonth[] = data.months.map((month, i) => {
    const moderate = index(month.peak) >= 3
    const reached = month.from !== null && month.to !== null
    return {
      ...month,
      month: names[i]!,
      short: shorts[i]!,
      band: uvBand(month.peak),
      label: uvLabel(month.peak),
      peakText: formatUV(month.peak),
      clearSkyText: formatUV(month.clearSky),
      hours:
        moderate && reached ? { from: hourText(month.from!), to: hourText(month.to!) } : null,
      someDays: !moderate && reached,
    }
  })
  const top = months.reduce((best, month) => (month.peak > best.peak ? month : best), months[0]!)
  const reaches3 = months.map(month => index(month.peak) >= 3)
  const season = monthSpan(reaches3)
  const lowSpan = monthSpan(reaches3.map(reached => !reached))
  const facts: string[] = [m.factPeak(city.name, top.month, top.peakText, top.label)]
  if (top.hours && top.from !== null && top.to !== null) {
    facts.push(m.factHours(top.month, hourText(top.from), hourText(top.to), Math.round(top.hours3)))
  }
  if (season) facts.push(season === m.allYear ? m.factAllYear : m.factSeason(season))
  if (lowSpan) facts.push(m.factLow(lowSpan))
  const cloudiest = months.reduce((best, month) =>
    month.clearSky - month.peak > best.clearSky - best.peak ? month : best,
  )
  if (index(cloudiest.clearSky) - index(cloudiest.peak) >= 1) {
    facts.push(m.factClouds(cloudiest.month, cloudiest.peakText, cloudiest.clearSkyText))
  }
  if (data.elevation >= 1000) {
    facts.push(m.factAltitude(formatNumber(Math.round(data.elevation / 10) * 10)))
  }
  const place = cityPlace(city)
  return {
    city,
    place,
    elevation: data.elevation,
    months,
    top,
    facts,
    related: relatedCities(city).map(localCity),
    title: m.title(city.name),
    description: m.description(place, top.peakText, top.month),
  }
}

/** The page's title. */
export function cityTitle(page: CityPage): string {
  return page.title
}

/** The page's meta description: unique per city, under about 160 characters. */
export function cityDescription(page: CityPage): string {
  return page.description
}

/**
 * Cities grouped by country, countries and cities in alphabetical order, for the index
 * page, with the names in the active language.
 */
export function citiesByCountry(): { country: string; cities: City[] }[] {
  const locale = currentLocale()
  const groups = new Map<string, City[]>()
  for (const city of CITIES.map(localCity)) {
    groups.set(city.country, [...(groups.get(city.country) ?? []), city])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, locale))
    .map(([country, cities]) => ({
      country,
      cities: cities.sort((a, b) => a.name.localeCompare(b.name, locale)),
    }))
}
