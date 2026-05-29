import type { Metadata, Viewport } from 'next'
import './globals.css'
import ThemeInit from '@/components/ThemeInit'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://solara.web.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Solara — Know when to go outside',
  description: 'Personalized UV and sun exposure dashboard. Know exactly when it is safer to go outside for your activity, skin type, and location.',
  applicationName: 'Solara',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
  openGraph: {
    title: 'Solara — Know when to go outside',
    description: 'Personalized UV and outdoor activity windows for your skin type and location.',
    type: 'website',
    siteName: 'Solara',
    images: [{ url: '/icon-512.svg', width: 512, height: 512, alt: 'Solara sun icon' }],
  },
  twitter: {
    card: 'summary',
    title: 'Solara — Know when to go outside',
    description: 'Personalized UV and outdoor activity windows for your skin type and location.',
    images: ['/icon-512.svg'],
  },
}

export const viewport: Viewport = {
  themeColor: '#F97316',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  )
}
