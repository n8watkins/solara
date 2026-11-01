import type { Locale } from '@solara/core/i18n'
import LanguageLink from '@/components/LanguageLink'
import SolaraMark from '@/components/SolaraMark'
import { localePath } from '@/lib/page-language'

/**
 * The header of the static pages (the landing page and the city pages): Solara, the link
 * to the page in the other language, and one button. Under 360 px the wordmark is read
 * but not shown (as in the app's header), so all three fit at 320 px in every language.
 */
export default function StaticHeader({
  path,
  locale,
  action,
  width,
}: {
  /** The page's English address, for its language link. */
  path: string
  locale: Locale
  /** The button: where it goes and what it says. */
  action: { href: string; label: string }
  /** The page column's Tailwind max-width class. */
  width: string
}) {
  return (
    <header
      className={`mx-auto flex ${width} items-center justify-between gap-3 px-4 py-4 sm:px-6`}
    >
      <a
        href={localePath('/', locale)}
        className="flex items-center gap-1.5 rounded-lg text-[18px] font-bold text-ink no-underline"
      >
        <SolaraMark size={24} />
        <span className="max-[359px]:sr-only">Solara</span>
      </a>
      <div className="flex items-center gap-4">
        <LanguageLink path={path} locale={locale} />
        <a
          href={action.href}
          className="btn px-4 py-2 text-[14px] font-semibold whitespace-nowrap no-underline"
        >
          {action.label}
        </a>
      </div>
    </header>
  )
}
