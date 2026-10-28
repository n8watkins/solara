import { describe, expect, it } from 'vitest'
import {
  CITIES,
  cityAppHref,
  cityDescription,
  cityPage,
  cityPath,
  cityPlace,
  citiesByCountry,
  hourText,
  monthSpan,
  relatedCities,
} from './city-pages'
import climatology from './cities/uv-climatology.json'
import { STATIC_PAGES } from './static-pages.mts'

const flags = (months: number[]) => Array.from({ length: 12 }, (_, i) => months.includes(i + 1))

describe('the city data', () => {
  it('has about 50 cities with unique slugs and twelve months of data each', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(50)
    expect(new Set(CITIES.map(c => c.slug)).size).toBe(CITIES.length)
    for (const city of CITIES) {
      expect(city.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(Intl.DateTimeFormat(undefined, { timeZone: city.timezone })).toBeTruthy()
      const data = (climatology.cities as Record<string, { months: unknown[] }>)[city.slug]
      expect(data?.months, city.slug).toHaveLength(12)
    }
  })

  it('serves every city page without the framework scripts', () => {
    for (const city of CITIES) expect(STATIC_PAGES).toContain(`uv/${city.slug}/index.html`)
    expect(STATIC_PAGES).toContain('uv/index.html')
  })
})

describe('monthSpan', () => {
  it('reads a run of months, wrapping past December', () => {
    expect(monthSpan(flags([4, 5, 6, 7, 8, 9]))).toBe('from April to September')
    expect(monthSpan(flags([10, 11, 12, 1, 2, 3]))).toBe('from October to March')
    expect(monthSpan(flags([6, 7]))).toBe('in June and July')
    expect(monthSpan(flags([12, 1]))).toBe('in December and January')
    expect(monthSpan(flags([7]))).toBe('in July')
  })

  it('lists months that do not run on, and says all year or nothing', () => {
    expect(monthSpan(flags([1, 3, 5]))).toBe('in January, March and May')
    expect(monthSpan(flags([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe('all year')
    expect(monthSpan(flags([]))).toBeNull()
  })
})

describe('cityPage', () => {
  it('describes a city from its data', () => {
    const page = cityPage('london')!
    expect(page.place).toBe('London, England')
    expect(page.top.month).toBe('June')
    expect(page.facts[0]).toBe(
      'UV in London is highest in June, when a typical day peaks around 4.9 (Moderate).',
    )
    expect(page.facts).toContain(
      'The typical midday UV reaches 3 or more from April to September, when public-health guidance recommends sun protection.',
    )
    expect(page.facts).toContain('UV usually stays under 3 from October to March.')
  })

  it('tells the southern hemisphere its own seasons, and high places their altitude', () => {
    expect(cityPage('sydney')!.top.month).toBe('December')
    expect(cityPage('sydney')!.facts).toContain('UV usually stays under 3 in June and July.')
    expect(cityPage('denver')!.facts.at(-1)).toMatch(/^At about 1,600 m above sea level/)
    expect(cityPage('singapore')!.facts).toContain(
      'The typical midday UV reaches 3 or more in every month, so sun protection is a year-round habit here.',
    )
  })

  it('gives every city its own description and facts', () => {
    const descriptions = CITIES.map(c => cityDescription(cityPage(c.slug)!))
    expect(new Set(descriptions).size).toBe(CITIES.length)
    for (const d of descriptions) expect(d.length).toBeLessThanOrEqual(160)
  })

  it('returns null for an unknown city', () => {
    expect(cityPage('atlantis')).toBeNull()
  })
})

describe('links', () => {
  it('builds the page path and the app preset', () => {
    expect(cityPath('new-york')).toBe('/uv/new-york/')
    expect(cityAppHref('new-york')).toBe('/app/?city=new-york')
  })

  it('names places without repeating a name', () => {
    expect(cityPlace(cityPage('singapore')!.city)).toBe('Singapore')
    expect(cityPlace(cityPage('tokyo')!.city)).toBe('Tokyo, Japan')
    expect(cityPlace(cityPage('austin')!.city)).toBe('Austin, Texas')
  })

  it('links the same country first, nearest first', () => {
    const related = relatedCities(cityPage('paris')!.city).map(c => c.slug)
    expect(related[0]).toBe('london')
    expect(relatedCities(cityPage('los-angeles')!.city)[0]!.slug).toBe('san-diego')
    expect(related).not.toContain('paris')
  })

  it('groups the index by country, alphabetically', () => {
    const groups = citiesByCountry()
    expect(groups.map(g => g.country)).toEqual([...groups.map(g => g.country)].sort())
    expect(groups.flatMap(g => g.cities)).toHaveLength(CITIES.length)
  })
})

describe('hourText', () => {
  it('reads 12-hour times', () => {
    expect([0, 9, 12, 18].map(hourText)).toEqual(['12am', '9am', '12pm', '6pm'])
  })
})
