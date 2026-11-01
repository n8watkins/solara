import type { ReactNode } from 'react'
import type { Locale } from '@solara/core/i18n'
import StaticHeader from '@/components/StaticHeader'
import { APP_PATH } from '@/lib/app-routes'
import { pageText } from '@/lib/page-language'

/**
 * The frame of the city pages (app/uv/, app/es/uv/): the Solara header with the link to
 * the page in the other language, and a centered column. Like the landing page these are
 * static HTML and CSS only (scripts/static-pages.mjs strips the framework scripts), so
 * links are plain anchors.
 */
export default function CityShell({
  appHref = APP_PATH,
  path,
  locale,
  children,
}: {
  /** Where "Open Solara" goes (a city page opens the app on that city). */
  appHref?: string
  /** The page's English address, for its language link. */
  path: string
  locale: Locale
  children: ReactNode
}) {
  const { site } = pageText(locale)
  return (
    <div className="bg-surface">
      <StaticHeader
        path={path}
        locale={locale}
        action={{ href: appHref, label: site.openSolara }}
        width="max-w-[960px]"
      />
      <main className="mx-auto max-w-[960px] px-4 pt-4 pb-16 sm:px-6 md:pt-8">{children}</main>
    </div>
  )
}
