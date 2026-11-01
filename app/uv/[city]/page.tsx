import { notFound } from 'next/navigation'
import CityPageView, { cityPageMetadata, cityParams } from '@/components/city/CityPageView'
import { cityBySlug } from '@/lib/city-pages'

// A city's typical UV by month in English; in Spanish at /es/uv/<city>/.

export const dynamicParams = false

export function generateStaticParams() {
  return cityParams()
}

type Props = { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Props) {
  return cityPageMetadata((await params).city, 'en')
}

export default async function Page({ params }: Props) {
  const slug = (await params).city
  if (!cityBySlug(slug)) notFound()
  return <CityPageView slug={slug} locale="en" />
}
