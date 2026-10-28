import Link from 'next/link'
import { notFound } from 'next/navigation'
import CityShell from '@/components/city/CityShell'
import { cityMetadata } from '@/components/city/metadata'
import {
  CITIES,
  CLIMATOLOGY_SOURCE,
  cityAppHref,
  cityDescription,
  cityPage,
  cityPath,
  cityTitle,
  hourText,
} from '@/lib/city-pages'
import { cityStructuredData, jsonLd } from '@/lib/structured-data'
import { formatUV, uvBandColor } from '@/lib/weather'

// One city's typical UV by month, built at export time from the checked-in data in
// lib/cities/. Static HTML and CSS only: scripts/static-pages.mjs strips the
// framework scripts, so a visitor from search downloads no JavaScript here; the only
// inline script is the page's structured data (JSON-LD), which is not code.

export const dynamicParams = false

export function generateStaticParams() {
  return CITIES.map(city => ({ city: city.slug }))
}

type Props = { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Props) {
  const page = cityPage((await params).city)
  if (!page) return {}
  return cityMetadata(cityTitle(page), cityDescription(page), cityPath(page.city.slug))
}

/** The chart's scale: UV 12 fills the bar area (Extreme starts at 11). */
const CHART_MAX = 12

const LINK_BUTTON = 'btn justify-center px-5 py-3 text-[15px] font-semibold no-underline'

export default async function CityUVPage({ params }: Props) {
  const page = cityPage((await params).city)
  if (!page) notFound()
  const { city, months, facts, related } = page
  const appHref = cityAppHref(city.slug)

  return (
    <CityShell appHref={appHref}>
      {/* Kept by scripts/static-pages.mjs (data-static) and hashed by scripts/csp.mjs. */}
      <script
        type="application/ld+json"
        data-static=""
        dangerouslySetInnerHTML={{ __html: jsonLd(cityStructuredData(page)) }}
      />
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3">
        <Link href="/uv/" className="text-inherit underline">
          UV by city
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{city.name}</span>
      </nav>

      <h1 className="mt-3 text-[clamp(30px,6vw,46px)] leading-[1.08] font-[750] tracking-[-0.02em] text-ink">
        UV index in {city.name}
      </h1>
      <p className="mt-2 text-[16px] text-ink-2">
        {city.region && city.region !== city.name ? `${city.region}, ` : ''}
        {city.country} · typical UV by month
      </p>

      <section
        aria-label={`Today in ${city.name}`}
        className="card mt-7 flex flex-col gap-4 border-accent-border bg-accent-soft/40 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-[17px] font-bold text-ink">Today&apos;s UV in {city.name}</p>
          <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">
            The hourly forecast and the lower-UV times for what you do outside. Free, no account
            needed.
          </p>
        </div>
        <a href={appHref} className={`${LINK_BUTTON} btn-primary shrink-0`}>
          See today&apos;s UV
        </a>
      </section>

      <section aria-labelledby="facts-heading" className="mt-10">
        <h2 id="facts-heading" className="text-[22px] font-[750] tracking-[-0.01em] text-ink">
          The year at a glance
        </h2>
        <ul className="mt-4 grid gap-2.5">
          {facts.map(fact => (
            <li key={fact} className="flex gap-2.5 text-[15px] leading-[1.6] text-ink-2">
              <span
                aria-hidden="true"
                className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent"
              />
              {fact}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="months-heading" className="mt-12">
        <h2 id="months-heading" className="text-[22px] font-[750] tracking-[-0.01em] text-ink">
          Typical UV by month
        </h2>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-ink-3">
          The highest UV index of a typical day, with clouds and under a clear sky, and the hours UV
          is usually 3 or more, from {CLIMATOLOGY_SOURCE.first} to {CLIMATOLOGY_SOURCE.last}.
        </p>

        {/* The bars repeat the table below for sighted readers. */}
        <div
          aria-hidden="true"
          data-testid="city-chart"
          className="card mt-5 grid grid-cols-12 items-end gap-1 px-3 pt-4 pb-3 sm:gap-2 sm:px-5"
        >
          {months.map(m => (
            <div key={m.month} className="flex min-w-0 flex-col items-center">
              <span className="text-[11px] font-semibold text-ink-2 tabular-nums sm:text-[12px]">
                {formatUV(m.peak)}
              </span>
              <div className="mt-1 flex h-[132px] w-full items-end justify-center">
                <div
                  className="w-full max-w-[34px] rounded-t-[6px]"
                  style={{
                    height: `${Math.max(4, (Math.min(m.peak, CHART_MAX) / CHART_MAX) * 100)}%`,
                    background: uvBandColor(m.band),
                  }}
                />
              </div>
              <span className="mt-1.5 text-[11px] text-ink-3 sm:text-[12px]">
                {m.month.slice(0, 3)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border-[0.5px] border-line-strong">
          <table className="w-full border-collapse text-left text-[13px] sm:text-[14px]">
            <caption className="sr-only">Typical UV index in {city.name} by month</caption>
            <thead className="bg-surface-subtle text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="px-2.5 py-2.5 sm:px-4 font-semibold">
                  Month
                </th>
                <th scope="col" className="px-2.5 py-2.5 sm:px-4 font-semibold">
                  Typical peak
                </th>
                <th scope="col" className="px-2.5 py-2.5 sm:px-4 font-semibold">
                  Clear sky
                </th>
                <th scope="col" className="px-2.5 py-2.5 sm:px-4 font-semibold">
                  UV 3 or more
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month} className="border-t-[0.5px] border-line text-ink-2">
                  <th scope="row" className="px-2.5 py-2.5 sm:px-4 font-semibold text-ink">
                    <span className="sm:hidden">{m.month.slice(0, 3)}</span>
                    <span className="hidden sm:inline">{m.month}</span>
                  </th>
                  <td className="px-2.5 py-2.5 sm:px-4 tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-[3px]"
                        style={{ background: uvBandColor(m.band) }}
                      />
                      {formatUV(m.peak)} {m.label}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 sm:px-4 tabular-nums">{formatUV(m.clearSky)}</td>
                  <td className="px-2.5 py-2.5 sm:px-4">
                    {m.from !== null && m.to !== null
                      ? `${hourText(m.from)}-${hourText(m.to)}`
                      : 'Rarely'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="about-heading" className="mt-12">
        <h2 id="about-heading" className="text-[17px] font-bold text-ink">
          About these numbers
        </h2>
        <p className="mt-2 max-w-[720px] text-[13px] leading-[1.65] text-ink-3">
          Averages of every day from {CLIMATOLOGY_SOURCE.first} to {CLIMATOLOGY_SOURCE.last} in the
          global atmospheric composition model of the{' '}
          <a
            href="https://atmosphere.copernicus.eu/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-inherit underline"
          >
            Copernicus Atmosphere Monitoring Service
          </a>
          , served by the{' '}
          <a
            href="https://open-meteo.com/en/docs/air-quality-api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-inherit underline"
          >
            Open-Meteo Air Quality API
          </a>{' '}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-inherit underline"
          >
            CC BY 4.0
          </a>
          ), for the city center, in local time. They describe a typical day, not any one day: the
          UV on a given day can be higher or lower, so check the forecast before you go. Solara is a
          planning aid, not medical advice.
        </p>
      </section>

      <nav aria-labelledby="related-heading" className="mt-12">
        <h2 id="related-heading" className="text-[17px] font-bold text-ink">
          UV in other cities
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {related.map(other => (
            <li key={other.slug}>
              <a
                href={cityPath(other.slug)}
                className="btn px-3.5 py-2 text-[14px] font-semibold no-underline"
              >
                {other.name}
              </a>
            </li>
          ))}
          <li>
            <Link href="/uv/" className="btn px-3.5 py-2 text-[14px] font-semibold no-underline">
              All cities
            </Link>
          </li>
        </ul>
      </nav>
    </CityShell>
  )
}
