// Structured data (JSON-LD) for the static city pages, so search engines can read the
// page's place and its place in the site. It ships as an inline
// `<script type="application/ld+json">`; scripts/csp.mjs hashes every inline script
// of the export into the page's Content-Security-Policy at build time, this one too,
// so there is no hash to keep in step by hand.

import { cityDescription, cityPath, cityPlace, cityTitle, type CityPage } from './city-pages'
import { SITE_URL } from './site'

/**
 * JSON for an inline script: `<`, `>` and `&` are escaped, so no text in the data can
 * close the script element or open a comment, and U+2028 and U+2029 for old parsers.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** A city page as a schema.org WebPage about the city, with its breadcrumb trail. */
export function cityStructuredData(page: CityPage) {
  const { city } = page
  const url = `${SITE_URL}${cityPath(city.slug)}`
  const region = city.region && city.region !== city.name ? city.region : undefined
  const webPage = {
    '@type': 'WebPage',
    '@id': url,
    url,
    name: cityTitle(page),
    description: cityDescription(page),
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'Solara', url: `${SITE_URL}/` },
    breadcrumb: { '@id': `${url}#breadcrumb` },
    about: {
      '@type': 'Place',
      name: cityPlace(city),
      geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
      address: {
        '@type': 'PostalAddress',
        addressLocality: city.name,
        ...(region ? { addressRegion: region } : {}),
        addressCountry: city.country,
      },
    },
  }
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Solara', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'UV by city', item: `${SITE_URL}/uv/` },
      { '@type': 'ListItem', position: 3, name: city.name, item: url },
    ],
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [webPage, breadcrumb] as const,
  }
}
