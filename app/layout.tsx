import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import ThemeInit from '@/components/ThemeInit'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'
// Interpolated into an inline script below — refuse anything that isn't a plain
// GA4 measurement id so a malformed env value can't break out of the string.
const RAW_GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const GA_ID = RAW_GA_ID && /^G-[A-Z0-9]+$/.test(RAW_GA_ID) ? RAW_GA_ID : undefined

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Solara: Plan around UV',
  description: 'Forecast-based, lower-UV activity planning personalized for your skin profile and location.',
  applicationName: 'Solara',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Solara: Plan around UV',
    description: 'Forecast-based, lower-UV activity planning for your skin profile and location.',
    type: 'website',
    siteName: 'Solara',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Solara lower-UV activity planner' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Solara: Plan around UV',
    description: 'Forecast-based, lower-UV activity planning for your skin profile and location.',
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
