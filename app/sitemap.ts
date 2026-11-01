import type { MetadataRoute } from 'next'
import { LOCALES } from '@solara/core/i18n'
import { CITIES, cityPath } from '@/lib/city-pages'
import { localePath } from '@/lib/page-language'
import { SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

/**
 * Each page in every language it has (lib/page-language.ts), each entry naming the others
 * as its hreflang alternates, English as x-default.
 */
function inEveryLanguage(
  path: string,
  entry: Omit<MetadataRoute.Sitemap[number], 'url'>,
): MetadataRoute.Sitemap {
  const languages = {
    ...Object.fromEntries(
      LOCALES.map(locale => [locale, `${SITE_URL}${localePath(path, locale)}`]),
    ),
    'x-default': `${SITE_URL}${path}`,
  }
  return LOCALES.map(locale => ({
    url: `${SITE_URL}${localePath(path, locale)}`,
    ...entry,
    alternates: { languages },
  }))
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    ...['', '/privacy/', '/terms/'].flatMap(path =>
      inEveryLanguage(path || '/', {
        changeFrequency: path ? 'monthly' : 'daily',
        priority: path ? 0.5 : 1,
      }),
    ),
    // The account page (data controls for a signed-in person) is left out and marked
    // noindex (app/account/layout.tsx): nothing on it is for searchers (REVIEW10 N8).
  ]
  // The city pages change only when their checked-in data does (lib/cities/).
  const cities = ['/uv/', ...CITIES.map(city => cityPath(city.slug))].flatMap(path =>
    inEveryLanguage(path, { changeFrequency: 'yearly', priority: 0.7 }),
  )
  return [...pages, ...cities]
}
