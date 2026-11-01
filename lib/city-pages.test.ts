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
import { formatUV } from './weather'
import climatology from './cities/uv-climatology.json'
import { STATIC_PAGES } from './static-pages.mts'
import { inPageLanguage } from './page-language'
import { cityStructuredData } from './structured-data'

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
      'The typical midday UV is moderate or higher from April to September, when public-health guidance recommends sun protection.',
    )
    expect(page.facts).toContain('UV usually stays low from October to March.')
  })

  it('tells the southern hemisphere its own seasons, and high places their altitude', () => {
    expect(cityPage('sydney')!.top.month).toBe('December')
    expect(cityPage('sydney')!.facts).toContain('UV usually stays low in June and July.')
    expect(cityPage('denver')!.facts.at(-1)).toMatch(/^At about 1,600 m above sea level/)
    expect(cityPage('singapore')!.facts).toContain(
      'The typical midday UV is moderate or higher in every month, so sun protection is a year-round habit here.',
    )
  })

  it('gives every city its own description and facts', () => {
    const descriptions = CITIES.map(c => cityDescription(cityPage(c.slug)!))
    expect(new Set(descriptions).size).toBe(CITIES.length)
    for (const d of descriptions) expect(d.length).toBeLessThanOrEqual(160)
  })

  it('never quotes a decimal under 3 beside "3 or more" (REVIEW5 L5)', () => {
    // Los Angeles: January's typical peak reads 2.5, which the WHO scale rounds to 3
    // (Moderate); the words name the band, as the table does, instead of the number.
    const page = cityPage('los-angeles')!
    expect(formatUV(page.months[0]!.peak)).toBe('2.5')
    expect(page.months[0]!.label).toBe('Moderate')
    for (const c of CITIES) {
      const city = cityPage(c.slug)!
      expect([...city.facts, cityDescription(city)].join(' ')).not.toMatch(/\b3 or more|under 3\b/)
    }
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

describe('the city pages in Spanish (ROADMAP item 46)', () => {
  const es = <T>(work: () => T) => inPageLanguage('es', work)

  it('names cities, regions, countries and months in Spanish', () => {
    const london = es(() => cityPage('london')!)
    expect(london.place).toBe('Londres, Inglaterra')
    expect(london.city.country).toBe('Reino Unido')
    expect(london.top.month).toBe('junio')
    expect(london.months[0]!.short).toBe('ene')
    expect(london.facts).toContain('El UV suele mantenerse bajo de octubre a marzo.')
    expect(london.title).toBe('Índice UV en Londres por mes | Solara')
    expect(es(() => monthSpan(flags([6, 7])))).toBe('en junio y julio')
    expect(es(() => monthSpan(flags([1, 3, 5])))).toBe('en enero, marzo y mayo')
    expect(es(() => hourText(13))).toBe('1\u00a0p.m.')
    // The related cities follow the same country, compared in English.
    expect(es(() => cityPage('los-angeles')!.related[0]!.name)).toBe('San Diego')
  })

  it('writes the same numbers as the English page', () => {
    for (const city of CITIES) {
      const en = cityPage(city.slug)!
      const spanish = es(() => cityPage(city.slug)!)
      expect(spanish.facts.length, city.slug).toBe(en.facts.length)
      expect(spanish.months.map(m => m.peakText)).toEqual(en.months.map(m => m.peakText))
      const numbers = (texts: string[]) =>
        texts
          .join(' ')
          .replace(/(\d),(\d{3})/g, '$1$2')
          .match(/\d+(?:\.\d+)?/g)
      expect(numbers(spanish.facts), city.slug).toEqual(numbers(en.facts))
    }
  })

  it('gives every city its own description, under 160 characters, in Spanish', () => {
    const descriptions = es(() => CITIES.map(city => cityDescription(cityPage(city.slug)!)))
    expect(new Set(descriptions).size).toBe(CITIES.length)
    for (const d of descriptions) expect(d.length, d).toBeLessThanOrEqual(160)
  })

  it('groups the index by country in Spanish, in Spanish order', () => {
    const countries = es(() => citiesByCountry().map(group => group.country))
    expect(countries[0]).toBe('Alemania')
    expect(countries).toContain('Estados Unidos')
    expect(countries).toEqual([...countries].sort((a, b) => a.localeCompare(b, 'es')))
  })

  it('describes the Spanish page in its structured data', () => {
    const data = es(() => cityStructuredData(cityPage('mexico-city')!))
    const [webPage, breadcrumb] = data['@graph']
    expect(webPage.url).toBe('https://solara-uv.web.app/es/uv/mexico-city/')
    expect(webPage.inLanguage).toBe('es')
    expect(webPage.about.name).toBe('Ciudad de México, México')
    expect(breadcrumb.itemListElement.map(item => item.name)).toEqual([
      'Solara',
      'UV por ciudad',
      'Ciudad de México',
    ])
  })

  it('leaves the language English afterwards', () => {
    es(() => cityPage('paris'))
    expect(cityPage('paris')!.city.name).toBe('Paris')
  })
})

describe('the hours column agrees with the category (REVIEW10 N9)', () => {
  it('never lists moderate hours for a month whose typical peak is Low', () => {
    for (const { slug } of CITIES) {
      for (const month of cityPage(slug)!.months) {
        if (month.label === 'Low') expect(month.hours, `${slug} ${month.month}`).toBeNull()
        if (month.hours) expect(month.someDays).toBe(false)
      }
    }
  })

  it('says "Some days" for a Low month most of whose days reach UV 3 (Sydney in July)', () => {
    const july = cityPage('sydney')!.months[6]!
    expect([july.peakText, july.label, july.hours, july.someDays]).toEqual([
      '2.4',
      'Low',
      null,
      true,
    ])
    const june = cityPage('sydney')!.months[5]!
    expect([june.label, june.hours, june.someDays]).toEqual(['Low', null, false])
  })
})
