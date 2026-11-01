import type { Locale } from '@solara/core/i18n'
import CityShell from '@/components/city/CityShell'
import { citiesByCountry, cityPage, cityPath } from '@/lib/city-pages'
import { inPageLanguage, localePath, pageMetadata, pageText } from '@/lib/page-language'

// The index of the city pages, in English (app/uv/) and Spanish (app/es/uv/): every city,
// grouped by country, with its typical peak.

export function cityIndexMetadata(locale: Locale) {
  const t = pageText(locale).cityPages
  return pageMetadata({
    title: t.indexTitle,
    description: t.indexDescription,
    path: '/uv/',
    locale,
  })
}

export default function CityIndexView({ locale }: { locale: Locale }) {
  const t = pageText(locale).cityPages
  const countries = inPageLanguage(locale, () =>
    citiesByCountry().map(({ country, cities }) => ({
      country,
      cities: cities.map(city => {
        const page = cityPage(city.slug)
        return {
          ...city,
          peak: page && t.peaksAround(page.top.peakText, page.top.month),
        }
      }),
    })),
  )
  return (
    <CityShell path="/uv/" locale={locale}>
      <p className="text-[13px] font-semibold tracking-[0.06em] text-accent uppercase">
        {t.indexEyebrow}
      </p>
      <h1 className="mt-2 text-[clamp(30px,6vw,44px)] leading-[1.08] font-[750] tracking-[-0.02em] text-ink">
        {t.uvByCity}
      </h1>
      <p className="mt-4 max-w-[620px] text-[16px] leading-[1.6] text-ink-2">{t.indexIntro}</p>
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {countries.map(({ country, cities }, i) => (
          <section key={country} aria-labelledby={`country-${i}`}>
            <h2 id={`country-${i}`} className="text-[17px] font-bold text-ink">
              {country}
            </h2>
            <ul className="mt-2.5 grid gap-1.5">
              {cities.map(city => (
                <li key={city.slug} className="text-[15px] leading-[1.5]">
                  <a
                    href={localePath(cityPath(city.slug), locale)}
                    className="font-semibold text-accent"
                  >
                    {city.name}
                  </a>
                  {city.peak && <span className="text-ink-3"> · {city.peak}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </CityShell>
  )
}
