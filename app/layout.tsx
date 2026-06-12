import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import ThemeInit from '@/components/ThemeInit'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://solara.web.app'
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Solara — Know when to go outside',
  description: 'Personalized UV and sun exposure dashboard. Know exactly when it is safer to go outside for your activity, skin type, and location.',
  applicationName: 'Solara',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Solara — Know when to go outside',
    description: 'Personalized UV and outdoor activity windows for your skin type and location.',
    type: 'website',
    siteName: 'Solara',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Solara — know your sun window' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Solara — Know when to go outside',
    description: 'Personalized UV and outdoor activity windows for your skin type and location.',
    images: ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#F97316',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
        <ThemeInit />
        {children}
      </body>
    </html>
  )
}
