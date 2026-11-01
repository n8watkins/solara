import { Globe } from 'lucide-react'
import type { Locale } from '@solara/core/i18n'
import { localePath, otherLocale, pageText } from '@/lib/page-language'

/**
 * The link from a static page to the same page in the other language (ROADMAP item 46),
 * named in that language: "Español" on an English page, "English" on a Spanish one.
 */
export default function LanguageLink({
  path,
  locale,
  className = '',
}: {
  /** The page's English address ("/privacy/"). */
  path: string
  locale: Locale
  className?: string
}) {
  const other = otherLocale(locale)
  const text = pageText(locale).site
  return (
    <a
      href={localePath(path, other)}
      hrefLang={other}
      lang={other}
      aria-label={text.otherLanguageLabel}
      className={`inline-flex items-center gap-1.5 rounded-lg text-[14px] font-semibold text-ink-2 no-underline hover:text-ink ${className}`}
    >
      <Globe size={16} aria-hidden="true" className="shrink-0" />
      {text.otherLanguage}
    </a>
  )
}
