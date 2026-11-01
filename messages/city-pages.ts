// The city pages (app/uv/ in English, app/es/uv/ in Spanish): typical UV by month for
// each city (lib/city-pages.ts), built as static HTML in each language.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('cityPages', {
  /** Month names as a sentence uses them, January first. */
  months: 'January,February,March,April,May,June,July,August,September,October,November,December',
  monthsShort: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec',

  // When UV is moderate or higher, or low, in a year (monthSpan).
  allYear: 'all year',
  inMonth: (month: string) => `in ${month}`,
  inMonths: (months: string) => `in ${months}`,
  fromMonthTo: (from: string, to: string) => `from ${from} to ${to}`,

  // The facts about a city, one sentence each.
  factPeak: (city: string, month: string, uv: string, label: string) =>
    `UV in ${city} is highest in ${month}, when a typical day peaks around ${uv} (${label}).`,
  factHours: (month: string, from: string, to: string, hours: number) =>
    `On a typical ${month} day, UV is moderate or higher from about ${from} to ${to}, about ${hours} hours.`,
  factAllYear:
    'The typical midday UV is moderate or higher in every month, so sun protection is a year-round habit here.',
  factSeason: (season: string) =>
    `The typical midday UV is moderate or higher ${season}, when public-health guidance recommends sun protection.`,
  factLow: (span: string) => `UV usually stays low ${span}.`,
  factClouds: (month: string, peak: string, clearSky: string) =>
    `Clouds take the most off in ${month}: a typical peak of ${peak}, against ${clearSky} under a clear sky. On a clear day, expect the higher number.`,
  factAltitude: (meters: string) =>
    `At about ${meters} m above sea level, UV here runs higher than on the coast: roughly 10% more for every 1,000 m.`,

  // A city's page.
  title: (city: string) => `UV index in ${city} by month | Solara`,
  description: (place: string, uv: string, month: string) =>
    `Typical UV index in ${place} by month: UV peaks around ${uv} in ${month}. See when UV is moderate or higher and today's forecast.`,
  breadcrumb: 'Breadcrumb',
  uvByCity: 'UV by city',
  heading: (city: string) => `UV index in ${city}`,
  typicalByMonth: 'typical UV by month',
  todayIn: (city: string) => `Today in ${city}`,
  todaysUv: (city: string) => `Today's UV in ${city}`,
  todayBody:
    'The hourly forecast and the lower-UV times for what you do outside. Free, no account needed.',
  seeToday: "See today's UV",
  yearAtAGlance: 'The year at a glance',
  monthsHeading: 'Typical UV by month',
  monthsIntro: (first: number, last: number) =>
    `The highest UV index of a typical day, with clouds and under a clear sky, and the hours UV is usually moderate or higher, from ${first} to ${last}. The categories follow the WHO scale, which rounds to whole numbers, so a typical peak of 2.5 already counts as Moderate.`,
  tableCaption: (city: string) => `Typical UV index in ${city} by month`,
  month: 'Month',
  typicalPeak: 'Typical peak',
  clearSky: 'Clear sky',
  moderateOrHigher: 'Moderate or higher',
  rarely: 'Rarely',
  aboutHeading: 'About these numbers',
  /** Before the link to the Copernicus service. */
  aboutSource: (first: number, last: number) =>
    `Averages of every day from ${first} to ${last} in the global atmospheric composition model of the `,
  copernicus: 'Copernicus Atmosphere Monitoring Service',
  /** Between it and the link to the Open-Meteo API. */
  aboutServedBy: ', served by the ',
  openMeteoApi: 'Open-Meteo Air Quality API',
  /** After the license, which closes in a parenthesis. */
  aboutCaveat:
    ', for the city center, in local time. They describe a typical day, not any one day: the UV on a given day can be higher or lower, so check the forecast before you go. Solara is a planning aid, not medical advice.',
  otherCities: 'UV in other cities',
  allCities: 'All cities',

  // The index of the city pages.
  indexTitle: 'UV index by city: typical UV by month | Solara',
  indexDescription:
    'Typical UV index by month for 50 cities in the United States and around the world, with when UV reaches 3 or more and when it stays low.',
  indexEyebrow: 'UV index by month',
  indexIntro:
    "How strong the sun gets in each month, from three years of daily UV data. Pick a city for its typical UV, the hours it reaches 3 or more, and a link to today's forecast.",
  peaksAround: (uv: string, month: string) => `peaks around ${uv} in ${month}`,
})
