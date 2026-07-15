import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/privacy/', '/terms/', '/account/'].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path ? 'monthly' : 'daily',
    priority: path ? 0.5 : 1,
  }))
}
