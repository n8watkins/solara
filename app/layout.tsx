import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import AnalyticsConsent from '@/components/AnalyticsConsent'
import ThemeInit from '@/components/ThemeInit'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'
import { SITE_URL } from '@/lib/site'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

// Variable Inter (one file, every weight from 100 to 900), bundled from npm and
// served from this origin: no request to Google at runtime, preloaded, and with a
// metric-matched fallback so the swap does not shift layout. The Fontsource file
// is used instead of next/font/google because the file next/font downloads
// renders with uneven letter spacing in Chromium on Linux.
const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
})

// Interpolated into an inline script below. Refuse anything that is not a plain
// GA4 measurement id so a malformed env value can't break out of the string.
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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AnalyticsConsent measurementId={GA_ID} />
        <ThemeInit />
        {children}
        <footer
          style={{
            padding: '20px 16px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-3)',
            background: 'var(--bg)',
          }}
        >
          <a href="/privacy/" style={{ color: 'inherit' }}>
            Privacy
          </a>
          <span aria-hidden="true"> · </span>
          <a href="/terms/" style={{ color: 'inherit' }}>
            Terms
          </a>
          <span aria-hidden="true"> · </span>
          <a href="/account/" style={{ color: 'inherit' }}>
            Account data
          </a>
        </footer>
      </body>
    </html>
  )
}
