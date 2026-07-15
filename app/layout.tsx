import type { Metadata, Viewport } from 'next'
import './globals.css'
import AnalyticsConsent from '@/components/AnalyticsConsent'
import ThemeInit from '@/components/ThemeInit'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://uv-activity-planner.web.app'
// Interpolated into an inline script below. Refuse anything that is not a plain
// GA4 measurement id so a malformed env value can't break out of the string.
const RAW_GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
const GA_ID = isAnalyticsMeasurementId(RAW_GA_ID) ? RAW_GA_ID : undefined

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
        <AnalyticsConsent measurementId={GA_ID} />
        <ThemeInit />
        {children}
        <footer style={{ padding: '20px 16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-3)', background: 'var(--bg)' }}>
          <a href="/privacy/" style={{ color: 'inherit' }}>Privacy</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms/" style={{ color: 'inherit' }}>Terms</a>
          <span aria-hidden="true"> · </span>
          <a href="/account/" style={{ color: 'inherit' }}>Account data</a>
        </footer>
      </body>
    </html>
  )
}
