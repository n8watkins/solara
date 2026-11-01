import Landing, { landingMetadata } from '@/components/landing/Landing'

// The landing page in English; in Spanish at /es/ (app/es/page.tsx).
export const metadata = landingMetadata('en')

export default function Page() {
  return <Landing locale="en" />
}
