import type { Metadata } from 'next'

const OG_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: 'Solara UV planner' }

/**
 * Title, description, canonical address and social cards for a city page. Next.js
 * replaces the layout's `openGraph` and `twitter` objects rather than merging them,
 * so the image is repeated here.
 */
export function cityMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      type: 'website',
      siteName: 'Solara',
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  }
}
