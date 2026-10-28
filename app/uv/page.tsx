import CityShell from '@/components/city/CityShell'
import { cityMetadata } from '@/components/city/metadata'
import { citiesByCountry, cityPage, cityPath } from '@/lib/city-pages'
import { formatUV } from '@/lib/weather'

// The index of the city pages: every city, grouped by country, with its typical peak.

const TITLE = 'UV index by city: typical UV by month | Solara'
const DESCRIPTION =
  'Typical UV index by month for 50 cities in the United States and around the world, with when UV reaches 3 or more and when it stays low.'

export const metadata = cityMetadata(TITLE, DESCRIPTION, '/uv/')

export default function CityIndex() {
  return (
    <CityShell>
      <p className="text-[13px] font-semibold tracking-[0.06em] text-accent uppercase">
        UV index by month
      </p>
      <h1 className="mt-2 text-[clamp(30px,6vw,44px)] leading-[1.08] font-[750] tracking-[-0.02em] text-ink">
        UV by city
      </h1>
      <p className="mt-4 max-w-[620px] text-[16px] leading-[1.6] text-ink-2">
        How strong the sun gets in each month, from three years of daily UV data. Pick a city for
        its typical UV, the hours it reaches 3 or more, and a link to today&apos;s forecast.
      </p>
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {citiesByCountry().map(({ country, cities }) => (
          <section key={country} aria-labelledby={`country-${country}`}>
            <h2 id={`country-${country}`} className="text-[17px] font-bold text-ink">
              {country}
            </h2>
            <ul className="mt-2.5 grid gap-1.5">
              {cities.map(city => {
                const page = cityPage(city.slug)
                return (
                  <li key={city.slug} className="text-[15px] leading-[1.5]">
                    <a href={cityPath(city.slug)} className="font-semibold text-accent">
                      {city.name}
                    </a>
                    {page && (
                      <span className="text-ink-3">
                        {' '}
                        · peaks around {formatUV(page.top.peak)} in {page.top.month}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </CityShell>
  )
}
