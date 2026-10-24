import type { Metadata, Viewport } from 'next'
import './globals.css'
import { inter } from './fonts'
import AnalyticsConsent from '@/components/AnalyticsConsent'
import ThemeInit from '@/components/ThemeInit'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'
import { SITE_URL } from '@/lib/site'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

// Refuse anything that is not a plain GA4 measurement id: it ends up in the
// gtag.js URL and GA config, and a malformed env value should disable analytics.
const RAW_GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const GA_ID = isAnalyticsMeasurementId(RAW_GA_ID) ? RAW_GA_ID : undefined

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Solara: Plan around UV',
  description:
    'Forecast-based, lower-UV activity planning personalized for your skin profile and location.',
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
    images: [
      { url: '/og-image.png', width: 1200, height: 630, alt: 'Solara lower-UV activity planner' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Solara: Plan around UV',
    description: 'Forecast-based, lower-UV activity planning for your skin profile and location.',
    images: ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F97316' },
    { media: '(prefers-color-scheme: dark)', color: '#111010' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head script sets the `dark` class before React hydrates, so the class
    // attribute legitimately differs from the server markup.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking on purpose: applies the theme before first paint (no flash). */}
        <script data-static="" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AnalyticsConsent measurementId={GA_ID} />
        <ThemeInit />
        {children}
        <footer className="bg-surface px-4 py-5 text-center text-[12px] text-ink-3">
          <a href="/privacy/" className="text-inherit">
            Privacy
          </a>
          <span aria-hidden="true"> · </span>
          <a href="/terms/" className="text-inherit">
            Terms
          </a>
          <span aria-hidden="true"> · </span>
          <a href="/account/" className="text-inherit">
            Account data
          </a>
        </footer>
      </body>
    </html>
  )
}
