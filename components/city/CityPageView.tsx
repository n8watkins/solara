import type { Locale } from '@solara/core/i18n'
import CityShell from '@/components/city/CityShell'
import {
  CITIES,
  CLIMATOLOGY_SOURCE,
  capitalized,
  cityAppHref,
  cityPage,
  cityPath,
} from '@/lib/city-pages'
import { inPageLanguage, localePath, pageMetadata, pageText } from '@/lib/page-language'
import { cityStructuredData, jsonLd } from '@/lib/structured-data'
import { uvBandColor } from '@/lib/weather'

// One city's typical UV by month, in English (app/uv/[city]/) and Spanish
// (app/es/uv/[city]/), built at export time from the checked-in data in lib/cities/.
// Static HTML and CSS only: scripts/static-pages.mjs strips the framework scripts, so a
// visitor from search downloads no JavaScript here; the only inline script is the page's
// structured data (JSON-LD), which is not code.

/** Every city, for generateStaticParams. */
export function cityParams() {
  return CITIES.map(city => ({ city: city.slug }))
}

/** A city's page and its structured data in a language, or null for an unknown city. */
function localPage(slug: string, locale: Locale) {
  return inPageLanguage(locale, () => {
    const page = cityPage(slug)
    return page && { page, structured: jsonLd(cityStructuredData(page)) }
  })
}

export function cityPageMetadata(slug: string, locale: Locale) {
  const found = localPage(slug, locale)
  if (!found) return {}
  return pageMetadata({
    title: found.page.title,
    description: found.page.description,
    path: cityPath(slug),
    locale,
  })
}

/** The chart's scale: UV 12 fills the bar area (Extreme starts at 11). */
const CHART_MAX = 12

const LINK_BUTTON = 'btn justify-center px-5 py-3 text-[15px] font-semibold no-underline'

export default function CityPageView({ slug, locale }: { slug: string; locale: Locale }) {
  const found = localPage(slug, locale)
  if (!found) return null
  const { page, structured } = found
  const { city, months, facts, related } = page
  const t = pageText(locale).cityPages
  const appHref = cityAppHref(city.slug)
  const path = cityPath(city.slug)
  const link = 'text-inherit underline'

  return (
    <CityShell appHref={appHref} path={path} locale={locale}>
      {/* Kept by scripts/static-pages.mjs (data-static) and hashed by scripts/csp.mjs. */}
      <script
        type="application/ld+json"
        data-static=""
        dangerouslySetInnerHTML={{ __html: structured }}
      />
      <nav aria-label={t.breadcrumb} className="text-[13px] text-ink-3">
        <a href={localePath('/uv/', locale)} className="text-inherit underline">
          {t.uvByCity}
        </a>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{city.name}</span>
      </nav>

      <h1 className="mt-3 text-[clamp(30px,6vw,46px)] leading-[1.08] font-[750] tracking-[-0.02em] text-ink">
        {t.heading(city.name)}
      </h1>
      <p className="mt-2 text-[16px] text-ink-2">
        {city.region && city.region !== city.name ? `${city.region}, ` : ''}
        {city.country} · {t.typicalByMonth}
      </p>

      <section
        aria-label={t.todayIn(city.name)}
        className="card mt-7 flex flex-col gap-4 border-accent-border bg-accent-soft/40 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-[17px] font-bold text-ink">{t.todaysUv(city.name)}</p>
          <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">{t.todayBody}</p>
        </div>
        <a href={appHref} className={`${LINK_BUTTON} btn-primary shrink-0`}>
          {t.seeToday}
        </a>
      </section>

      <section aria-labelledby="facts-heading" className="mt-10">
        <h2 id="facts-heading" className="text-[22px] font-[750] tracking-[-0.01em] text-ink">
          {t.yearAtAGlance}
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
          {t.monthsHeading}
        </h2>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-ink-3">
          {t.monthsIntro(CLIMATOLOGY_SOURCE.first, CLIMATOLOGY_SOURCE.last)}
        </p>

        {/* The bars repeat the table below for sighted readers. */}
        <div
          aria-hidden="true"
          data-testid="city-chart"
          className="card mt-5 grid grid-cols-12 items-end gap-1 px-3 pt-4 pb-3 max-[399px]:gap-0.5 max-[399px]:px-2 sm:gap-2 sm:px-5"
        >
          {months.map(m => (
            <div key={m.month} className="flex min-w-0 flex-col items-center">
              <span className="text-[11px] font-semibold tracking-[-0.03em] text-ink-2 tabular-nums max-[399px]:text-[10px] sm:text-[12px] sm:tracking-normal">
                {m.peakText}
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
                {capitalized(m.short)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border-[0.5px] border-line-strong">
          <table className="w-full border-collapse text-left text-[13px] sm:text-[14px]">
            <caption className="sr-only">{t.tableCaption(city.name)}</caption>
            <thead className="bg-surface-subtle text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 font-semibold">
                  {t.month}
                </th>
                <th scope="col" className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 font-semibold">
                  {t.typicalPeak}
                </th>
                <th scope="col" className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 font-semibold">
                  {t.clearSky}
                </th>
                <th scope="col" className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 font-semibold">
                  {t.moderateOrHigher}
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month} className="border-t-[0.5px] border-line text-ink-2">
                  <th
                    scope="row"
                    className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 font-semibold text-ink"
                  >
                    <span className="sm:hidden">{capitalized(m.short)}</span>
                    <span className="hidden sm:inline">{capitalized(m.month)}</span>
                  </th>
                  <td className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-[3px]"
                        style={{ background: uvBandColor(m.band) }}
                      />
                      {m.peakText} {m.label}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4 tabular-nums">
                    {m.clearSkyText}
                  </td>
                  <td className="px-2.5 py-2.5 max-[359px]:px-1.5 sm:px-4">
                    {/* May break after the dash on a narrow phone ("10 a.m.-" / "2 p.m."). */}
                    {m.hours ? (
                      <>
                        {m.hours.from}-<wbr />
                        {m.hours.to}
                      </>
                    ) : m.someDays ? (
                      t.someDays
                    ) : (
                      t.rarely
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="about-heading" className="mt-12">
        <h2 id="about-heading" className="text-[17px] font-bold text-ink">
          {t.aboutHeading}
        </h2>
        <p className="mt-2 max-w-[720px] text-[13px] leading-[1.65] text-ink-3">
          {t.aboutSource(CLIMATOLOGY_SOURCE.first, CLIMATOLOGY_SOURCE.last)}
          <a
            href="https://atmosphere.copernicus.eu/"
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            {t.copernicus}
          </a>
          {t.aboutServedBy}
          <a
            href="https://open-meteo.com/en/docs/air-quality-api"
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            {t.openMeteoApi}
          </a>{' '}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            CC&nbsp;BY&nbsp;4.0
          </a>
          ){t.aboutCaveat}
        </p>
      </section>

      <nav aria-labelledby="related-heading" className="mt-12">
        <h2 id="related-heading" className="text-[17px] font-bold text-ink">
          {t.otherCities}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {related.map(other => (
            <li key={other.slug}>
              <a
                href={localePath(cityPath(other.slug), locale)}
                className="btn px-3.5 py-2 text-[14px] font-semibold no-underline"
              >
                {other.name}
              </a>
            </li>
          ))}
          <li>
            <a
              href={localePath('/uv/', locale)}
              className="btn px-3.5 py-2 text-[14px] font-semibold no-underline"
            >
              {t.allCities}
            </a>
          </li>
        </ul>
      </nav>
    </CityShell>
  )
}
