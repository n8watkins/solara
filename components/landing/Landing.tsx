import { Check, Clock, Footprints, MapPin, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Locale } from '@solara/core/i18n'
import DataAttribution from '@/components/DataAttribution'
import StaticHeader from '@/components/StaticHeader'
import { APP_PATH, SIGN_IN_PATH } from '@/lib/app-routes'
import { CITIES, cityPath, localCity } from '@/lib/city-pages'
import { LANDING_REDIRECT_SCRIPT } from '@/lib/landing-redirect'
import { inPageLanguage, localePath, pageMetadata, pageText } from '@/lib/page-language'
import { proFeatures, PRO_PLAN, type ProFeature } from '@/lib/plans'
import pricing from '@/messages/pricing'
import setup from '@/messages/setup'

// The landing page, in English at / (app/page.tsx) and in Spanish at /es/
// (app/es/page.tsx): static HTML and CSS only. scripts/static-pages.mjs strips the
// framework scripts from the exported pages, so they load no JavaScript besides the
// inline theme and redirect scripts, and nothing from Firebase. The app is at /app/.

type Column = 'guest' | 'free' | 'pro'

/** A plan's features, from the same comparison the pricing dialog shows, in the active language. */
function planFeatures(column: Column, comingSoon: (feature: string) => string): string[] {
  return proFeatures().flatMap((feature: ProFeature) => {
    const value = feature[column]
    if (value === false) return []
    if (value === true) return [feature.label]
    if (value === pricing.comingSoon) return [comingSoon(feature.label)]
    return [`${feature.label}: ${value}`]
  })
}

const STORE_BUILD = process.env.NEXT_PUBLIC_STORE_BUILD === '1'

const BUTTON = 'btn justify-center px-5 py-3 text-[15px] font-semibold no-underline'

/** The landing page's title, description and alternates in a language. */
export function landingMetadata(locale: Locale) {
  const t = pageText(locale).landing
  return pageMetadata({
    title: t.title,
    description: t.description,
    socialDescription: t.socialDescription,
    path: '/',
    locale,
  })
}

function PlanCard({
  name,
  price,
  note,
  column,
  features,
  action,
  featured = false,
}: {
  name: string
  price: ReactNode
  note: string
  column: Column
  features: string[]
  action?: ReactNode
  featured?: boolean
}) {
  return (
    <section
      aria-labelledby={`plan-${column}`}
      className={
        featured
          ? 'card flex flex-col border-accent-border bg-accent-soft/40'
          : 'card flex flex-col'
      }
    >
      <h3 id={`plan-${column}`} className="text-[15px] font-bold text-ink">
        {name}
      </h3>
      <p className="mt-1.5 text-ink">{price}</p>
      <p className="mt-1 text-[13px] text-ink-3">{note}</p>
      <ul className="mt-4 mb-5 flex flex-col gap-2 text-[14px] text-ink-2">
        {features.map(feature => (
          <li key={feature} className="flex gap-2">
            <Check size={16} strokeWidth={2.5} className="mt-[3px] shrink-0 text-success" />
            {feature}
          </li>
        ))}
      </ul>
      {action && <div className="mt-auto">{action}</div>}
    </section>
  )
}

export default function Landing({ locale }: { locale: Locale }) {
  const { landing: t, site } = pageText(locale)
  // Words from the app's catalogues, in the page's language.
  const { features, cities, attribution } = inPageLanguage(locale, () => ({
    features: {
      guest: planFeatures('guest', t.featureComingSoon),
      free: planFeatures('free', t.featureComingSoon),
      pro: planFeatures('pro', t.featureComingSoon),
    },
    cities: CITIES.map(localCity),
    attribution: { ...setup },
  }))
  const steps: { Icon: LucideIcon; title: string; body: string }[] = [
    { Icon: MapPin, title: t.stepPlaceTitle, body: t.stepPlaceBody },
    { Icon: Footprints, title: t.stepActivitiesTitle, body: t.stepActivitiesBody },
    // Free already picks the best of its two days (REVIEW9 QA L7); Pro looks 10 days out.
    { Icon: Clock, title: t.stepGoTitle, body: t.stepGoBody },
  ]
  // The phone screenshot shows the app in the page's language (tests/harness/landing-shots.spec.ts).
  const shot = (scheme: 'light' | 'dark') =>
    `/landing/dashboard${locale === 'en' ? '' : `-${locale}`}-${scheme}.webp`

  return (
    <>
      {/* A browser with a Solara account goes straight to the app (old bookmarks of /). */}
      <script data-static="" dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <div className="bg-surface">
        <StaticHeader
          path="/"
          locale={locale}
          action={{ href: SIGN_IN_PATH, label: site.signIn }}
          width="max-w-[1080px]"
        />

        <main>
          <section className="mx-auto grid max-w-[1080px] items-center gap-10 px-4 pt-6 pb-16 sm:px-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-12 md:pt-14 md:pb-24">
            <div>
              <p className="text-[13px] font-semibold tracking-[0.06em] text-accent uppercase">
                {t.eyebrow}
              </p>
              <h1 className="mt-3 text-[clamp(38px,7vw,58px)] leading-[1.04] font-[750] tracking-[-0.02em] text-ink">
                {t.heading}
              </h1>
              <p className="mt-5 max-w-[540px] text-[17px] leading-[1.6] text-ink-2">{t.intro}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={APP_PATH} className={`${BUTTON} btn-primary min-w-[150px]`}>
                  {t.tryItNow}
                </a>
                <a href={SIGN_IN_PATH} className={`${BUTTON} min-w-[150px] bg-surface-card`}>
                  {site.signIn}
                </a>
              </div>
              <p className="mt-3.5 text-[13px] text-ink-3">{t.freeToUse}</p>
            </div>

            <figure className="mx-auto w-full max-w-[330px] md:max-w-[380px]">
              <picture>
                <source srcSet={shot('dark')} media="(prefers-color-scheme: dark)" />
                <img
                  src={shot('light')}
                  width={780}
                  height={1352}
                  fetchPriority="high"
                  decoding="async"
                  alt={t.screenshotAlt}
                  className="block h-auto w-full rounded-[34px] border-[6px] border-[#1c1c1c] bg-surface-card shadow-[0_24px_60px_rgba(26,18,8,0.18)]"
                />
              </picture>
              <figcaption className="sr-only">{t.screenshotCaption}</figcaption>
            </figure>
          </section>

          <section
            aria-labelledby="how-heading"
            className="border-t-[0.5px] border-line-strong bg-surface-subtle"
          >
            <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6 md:py-20">
              <h2 id="how-heading" className="text-[28px] font-[750] tracking-[-0.01em] text-ink">
                {t.howItWorks}
              </h2>
              <ol className="mt-8 grid gap-4 md:grid-cols-3">
                {steps.map((step, i) => (
                  <li key={step.title} className="card">
                    <p className="flex items-center gap-2.5 text-[13px] font-semibold text-ink-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <step.Icon size={18} />
                      </span>
                      {t.step(i + 1)}
                    </p>
                    <h3 className="mt-3 text-[17px] font-bold text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-[1.6] text-ink-2">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* A store build (lib/store-build.ts) shows no prices; its landing page also
              goes straight to the app. */}
          {!STORE_BUILD && (
            <section aria-labelledby="plans-heading" id="plans">
              <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6 md:py-20">
                <h2
                  id="plans-heading"
                  className="text-[28px] font-[750] tracking-[-0.01em] text-ink"
                >
                  {t.plansHeading}
                </h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.6] text-ink-2">
                  {t.plansIntro}
                </p>
                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <PlanCard
                    name={t.guest}
                    column="guest"
                    features={features.guest}
                    price={<span className="text-[28px] font-extrabold">$0</span>}
                    note={t.guestNote}
                    action={
                      <a href={APP_PATH} className={`${BUTTON} btn-primary w-full`}>
                        {t.tryItNow}
                      </a>
                    }
                  />
                  <PlanCard
                    name={t.freeAccount}
                    column="free"
                    features={features.free}
                    price={<span className="text-[28px] font-extrabold">$0</span>}
                    note={t.freeNote}
                    action={
                      <a href={SIGN_IN_PATH} className={`${BUTTON} w-full bg-surface-card`}>
                        {t.signInFree}
                      </a>
                    }
                  />
                  <PlanCard
                    name={t.pro}
                    column="pro"
                    features={features.pro}
                    featured
                    price={
                      <>
                        <span className="text-[28px] font-extrabold">{PRO_PLAN.monthly}</span>
                        <span className="text-[14px] text-ink-3">{t.perMonth}</span>
                      </>
                    }
                    note={t.proNote(PRO_PLAN.yearly, PRO_PLAN.trialDays)}
                    action={
                      <a href={SIGN_IN_PATH} className={`${BUTTON} w-full bg-surface-card`}>
                        {t.joinWaitlist}
                      </a>
                    }
                  />
                </div>
              </div>
            </section>
          )}

          <section
            aria-labelledby="cities-heading"
            className="border-t-[0.5px] border-line-strong bg-surface-subtle"
          >
            <div className="mx-auto max-w-[1080px] px-4 py-14 sm:px-6 md:py-16">
              <h2
                id="cities-heading"
                className="text-[22px] font-[750] tracking-[-0.01em] text-ink"
              >
                {t.citiesHeading}
              </h2>
              <p className="mt-2 max-w-[600px] text-[15px] leading-[1.6] text-ink-2">
                {t.citiesIntro}
              </p>
              <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
                {cities.map(city => (
                  <li key={city.slug}>
                    <a
                      href={localePath(cityPath(city.slug), locale)}
                      className="text-ink-2 underline"
                    >
                      {city.name}
                    </a>
                  </li>
                ))}
                <li>
                  <a href={localePath('/uv/', locale)} className="font-semibold text-accent">
                    {t.allCities}
                  </a>
                </li>
              </ul>
            </div>
          </section>

          <section className="border-t-[0.5px] border-line-strong">
            <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-2 px-4 py-8 text-center sm:px-6">
              <p className="max-w-[720px] text-[13px] leading-[1.6] text-ink-3">
                {site.disclaimer}
              </p>
              <DataAttribution text={attribution} />
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
