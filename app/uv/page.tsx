import CityIndexView, { cityIndexMetadata } from '@/components/city/CityIndexView'

// The city pages' index in English; in Spanish at /es/uv/ (app/es/uv/page.tsx).
export const metadata = cityIndexMetadata('en')

export default function Page() {
  return <CityIndexView locale="en" />
}
