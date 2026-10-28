import { describe, expect, it } from 'vitest'

import { cityPage } from './city-pages'
import { cityStructuredData, jsonLd } from './structured-data'

describe('city structured data', () => {
  it('describes the page, its city and its breadcrumb trail', () => {
    const data = cityStructuredData(cityPage('los-angeles')!)
    const [webPage, breadcrumb] = data['@graph']
    expect(webPage).toMatchObject({
      '@type': 'WebPage',
      url: 'https://solara-uv.web.app/uv/los-angeles/',
      name: 'UV index in Los Angeles by month | Solara',
      about: {
        '@type': 'Place',
        name: 'Los Angeles, California',
        geo: { '@type': 'GeoCoordinates' },
        address: { addressRegion: 'California', addressCountry: 'United States' },
      },
    })
    expect(webPage.description).toMatch(/^Typical UV index in Los Angeles/)
    expect(breadcrumb.itemListElement.map(item => item.name)).toEqual([
      'Solara',
      'UV by city',
      'Los Angeles',
    ])
  })

  it('leaves out a region that is the city itself', () => {
    const data = cityStructuredData(cityPage('singapore')!)
    expect(data['@graph'][0].about.address).not.toHaveProperty('addressRegion')
  })
})

describe('jsonLd', () => {
  it('cannot end the script element or open a comment', () => {
    const text = jsonLd({ name: '</script><!-- & \u2028' })
    expect(text).not.toMatch(/[<>&\u2028]/)
    expect(JSON.parse(text)).toEqual({ name: '</script><!-- & \u2028' })
  })
})
