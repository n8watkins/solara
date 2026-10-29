import { Check, Clock, Footprints, MapPin, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import DataAttribution from '@/components/DataAttribution'
import { APP_PATH, LANDING_REDIRECT_SCRIPT, SIGN_IN_PATH } from '@/lib/app-routes'
import { CITIES, cityPath } from '@/lib/city-pages'
import { PRO_FEATURES, PRO_PLAN, type ProFeature } from '@/lib/plans'
import SolaraMark from '@/components/SolaraMark'

// The landing page: static HTML and CSS only. scripts/static-pages.mjs strips the
// framework scripts from the exported page, so it loads no JavaScript besides the
// inline theme and redirect scripts, and nothing from Firebase. The app is at /app/.

const STEPS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: MapPin,
    title: 'Set your place and skin',
    body: 'Type a city or use your location, then pick your skin type. You see the live UV index right away.',
  },
  {
    Icon: Footprints,
    title: 'Add what you do outside',
    body: 'Running, hiking, swimming, gardening or your own activity, each with how much sun it can take.',
  },
  {
    Icon: Clock,
    title: 'Go at the lower-UV time',
    body: "Solara reads the hourly forecast and shows each activity's lower-UV window, with the best day of the week on Pro.",
  },
]

type Column = 'guest' | 'free' | 'pro'

/** A plan's features, from the same comparison the pricing dialog shows. */
function planFeatures(column: Column): string[] {
  return PRO_FEATURES.flatMap((feature: ProFeature) => {
    const value = feature[column]
    if (value === false) return []
    if (value === true) return [feature.label]
    if (value === 'Coming soon') return [`${feature.label} (coming soon)`]
    return [`${feature.label}: ${value}`]
  })
}

const STORE_BUILD = process.env.NEXT_PUBLIC_STORE_BUILD === '1'

const BUTTON = 'btn justify-center px-5 py-3 text-[15px] font-semibold no-underline'

function PlanCard({
  name,
  price,
  note,
  column,
  action,
  featured = false,
}: {
  name: string
  price: ReactNode
  note: string
  column: Column
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
        {planFeatures(column).map(feature => (
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

export default function Landing() {
  return (
    <>
      {/* A browser with a Solara account goes straight to the app (old bookmarks of /). */}
      <script data-static="" dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <div className="bg-surface">
        <header className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg text-[18px] font-bold text-ink no-underline"
          >
            <SolaraMark size={24} />
            Solara
          </Link>
          <a href={SIGN_IN_PATH} className="btn px-4 py-2 text-[14px] font-semibold no-underline">
            Sign in
          </a>
        </header>

        <main>
          <section className="mx-auto grid max-w-[1080px] items-center gap-10 px-4 pt-6 pb-16 sm:px-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-12 md:pt-14 md:pb-24">
            <div>
              <p className="text-[13px] font-semibold tracking-[0.06em] text-accent uppercase">
                UV planning for outdoor people
              </p>
              <h1 className="mt-3 text-[clamp(38px,7vw,58px)] leading-[1.04] font-[750] tracking-[-0.02em] text-ink">
                Know when to go outside
              </h1>
              <p className="mt-5 max-w-[540px] text-[17px] leading-[1.6] text-ink-2">
                Solara reads the UV forecast where you are and finds the lower-UV windows for
                running, hiking, swimming and everything else you do outside, tuned to your skin.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={APP_PATH} className={`${BUTTON} btn-primary min-w-[150px]`}>
                  Try it now
                </a>
                <a href={SIGN_IN_PATH} className={`${BUTTON} min-w-[150px] bg-surface-card`}>
                  Sign in
                </a>
              </div>
              <p className="mt-3.5 text-[13px] text-ink-3">
                Free to use. No account needed to start.
              </p>
            </div>

            <figure className="mx-auto w-full max-w-[330px] md:max-w-[380px]">
              <picture>
                <source
                  srcSet="/landing/dashboard-dark.webp"
                  media="(prefers-color-scheme: dark)"
                />
                <img
                  src="/landing/dashboard-light.webp"
                  width={780}
                  height={1352}
                  fetchPriority="high"
                  decoding="async"
                  alt="Solara on a phone: the next lower-UV slot for a run, the UV index now and the hourly UV forecast for today."
                  className="block h-auto w-full rounded-[34px] border-[6px] border-[#1c1c1c] bg-surface-card shadow-[0_24px_60px_rgba(26,18,8,0.18)]"
                />
              </picture>
              <figcaption className="sr-only">A screenshot of the Solara dashboard.</figcaption>
            </figure>
          </section>

          <section
            aria-labelledby="how-heading"
            className="border-t-[0.5px] border-line-strong bg-surface-subtle"
          >
            <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6 md:py-20">
              <h2 id="how-heading" className="text-[28px] font-[750] tracking-[-0.01em] text-ink">
                How it works
              </h2>
              <ol className="mt-8 grid gap-4 md:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="card">
                    <p className="flex items-center gap-2.5 text-[13px] font-semibold text-ink-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <step.Icon size={18} />
                      </span>
                      Step {i + 1}
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
                  Start free, upgrade when you want more
                </h2>
                <p className="mt-2 max-w-[600px] text-[15px] leading-[1.6] text-ink-2">
                  Try Solara without an account. Sign in free to keep your plan on every device.
                </p>
                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <PlanCard
                    name="Guest"
                    column="guest"
                    price={<span className="text-[28px] font-extrabold">$0</span>}
                    note="No sign-in. Your plan stays on this device."
                    action={
                      <a href={APP_PATH} className={`${BUTTON} btn-primary w-full`}>
                        Try it now
                      </a>
                    }
                  />
                  <PlanCard
                    name="Free account"
                    column="free"
                    price={<span className="text-[28px] font-extrabold">$0</span>}
                    note="Sign in with Google. Synced everywhere."
                    action={
                      <a href={SIGN_IN_PATH} className={`${BUTTON} w-full bg-surface-card`}>
                        Sign in free
                      </a>
                    }
                  />
                  <PlanCard
                    name="Pro"
                    column="pro"
                    featured
                    price={
                      <>
                        <span className="text-[28px] font-extrabold">{PRO_PLAN.monthly}</span>
                        <span className="text-[14px] text-ink-3"> / month</span>
                      </>
                    }
                    note={`or ${PRO_PLAN.yearly} a year. ${PRO_PLAN.trialDays}-day free trial. Coming soon: sign in to join the waitlist.`}
                    action={
                      <a href={SIGN_IN_PATH} className={`${BUTTON} w-full bg-surface-card`}>
                        Join the waitlist
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
                Typical UV by city
              </h2>
              <p className="mt-2 max-w-[600px] text-[15px] leading-[1.6] text-ink-2">
                How strong the sun gets each month, and when UV reaches 3 or more.
              </p>
              <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
                {CITIES.map(city => (
                  <li key={city.slug}>
                    <a href={cityPath(city.slug)} className="text-ink-2 underline">
                      {city.name}
                    </a>
                  </li>
                ))}
                <li>
                  <Link href="/uv/" className="font-semibold text-accent">
                    All cities
                  </Link>
                </li>
              </ul>
            </div>
          </section>

          <section className="border-t-[0.5px] border-line-strong">
            <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-2 px-4 py-8 text-center sm:px-6">
              <p className="max-w-[720px] text-[13px] leading-[1.6] text-ink-3">
                Solara is a planning aid, not medical advice or a guarantee that sun exposure is
                safe. Conditions and individual sensitivity can change quickly.
              </p>
              <DataAttribution />
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
