import CityIndexView, { cityIndexMetadata } from '@/components/city/CityIndexView'

// The city pages' index in Spanish; in English at /uv/ (app/uv/page.tsx).
export const metadata = cityIndexMetadata('es')

export default function Page() {
  return <CityIndexView locale="es" />
}
