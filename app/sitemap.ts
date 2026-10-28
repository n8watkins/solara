import type { MetadataRoute } from 'next'
import { CITIES, cityPath } from '@/lib/city-pages'
import { SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = ['', '/privacy/', '/terms/', '/account/'].map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path ? 'monthly' : 'daily',
    priority: path ? 0.5 : 1,
  }))
  // The city pages change only when their checked-in data does (lib/cities/).
  const cities: MetadataRoute.Sitemap = ['/uv/', ...CITIES.map(city => cityPath(city.slug))].map(
    path => ({ url: `${SITE_URL}${path}`, changeFrequency: 'yearly', priority: 0.7 }),
  )
  return [...pages, ...cities]
}
