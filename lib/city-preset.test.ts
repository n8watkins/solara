import { describe, expect, it } from 'vitest'
import { cityLocation, cityParam, loadCityLocation } from './city-preset'
import cities from './cities/cities.json'

describe('cityParam', () => {
  it('reads a city slug from the query', () => {
    expect(cityParam('?city=new-york')).toBe('new-york')
    expect(cityParam('?signin&city=tokyo')).toBe('tokyo')
  })

  it('refuses anything that is not a plain slug', () => {
    expect(cityParam('')).toBeNull()
    expect(cityParam('?city=')).toBeNull()
    expect(cityParam('?city=New York')).toBeNull()
    expect(cityParam('?city=../x')).toBeNull()
    expect(cityParam(`?city=${'a'.repeat(41)}`)).toBeNull()
  })
})

describe('cityLocation', () => {
  it('is the place setup would have chosen', () => {
    expect(cityLocation(cities, 'austin')).toEqual({
      lat: 30.2672,
      lon: -97.7431,
      city: 'Austin',
      region: 'Texas',
      timezone: 'America/Chicago',
    })
    // A region that repeats the name gives way to the country.
    expect(cityLocation(cities, 'tokyo')?.region).toBe('Japan')
  })

  it('knows only the listed cities', async () => {
    expect(cityLocation(cities, 'atlantis')).toBeNull()
    expect(await loadCityLocation('atlantis')).toBeNull()
    expect((await loadCityLocation('paris'))?.city).toBe('Paris')
  })
})
