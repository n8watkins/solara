import type { ReactNode } from 'react'
import type { Locale } from '@solara/core/i18n'
import LanguageLink from '@/components/LanguageLink'
import { localePath, pageText } from '@/lib/page-language'

export default function LegalPage({
  title,
  updated,
  path,
  locale = 'en',
  notice,
  children,
}: {
  title: string
  /** The date of the text, already in the page's language. */
  updated: string
  /** The page's English address, for its language link. */
  path: string
  locale?: Locale
  /** A note under the date: a translation says which English version it translates. */
  notice?: ReactNode
  children: ReactNode
}) {
  const { site } = pageText(locale)
  return (
    <main className="min-h-screen bg-surface px-4 pt-8 pb-16">
      <article className="card mx-auto max-w-[760px] p-[clamp(20px,5vw,48px)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <a href={localePath('/', locale)} className="text-[14px] text-accent no-underline">
            {site.backToSolara}
          </a>
          <LanguageLink path={path} locale={locale} />
        </div>
        <h1 className="mt-6 mb-1.5 text-[clamp(28px,6vw,42px)] leading-[1.1] font-[750]">
          {title}
        </h1>
        <p className={`${notice ? 'mb-3' : 'mb-8'} text-[13px] text-ink-3`}>
          {site.lastUpdated(updated)}
        </p>
        {notice && (
          <p className="mb-8 rounded-lg border-[0.5px] border-line-strong bg-surface-subtle px-3.5 py-2.5 text-[13px] leading-[1.55] text-ink-2 [&_a]:underline [&_a]:underline-offset-2">
            {notice}
          </p>
        )}
        <div className="legal-copy">{children}</div>
      </article>
    </main>
  )
}
