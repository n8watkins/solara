import Landing, { landingMetadata } from '@/components/landing/Landing'

// The landing page in Spanish; in English at / (app/page.tsx).
export const metadata = landingMetadata('es')

export default function Page() {
  return <Landing locale="es" />
}
