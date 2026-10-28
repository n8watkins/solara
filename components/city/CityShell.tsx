import Link from 'next/link'
import type { ReactNode } from 'react'
import { APP_PATH } from '@/lib/app-routes'
import SolaraMark from '@/components/SolaraMark'

/**
 * The frame of the city pages (app/uv/): the Solara header and a centered column.
 * Like the landing page these are static HTML and CSS only (scripts/static-pages.mjs
 * strips the framework scripts), so links are plain anchors.
 */
export default function CityShell({
  appHref = APP_PATH,
  children,
}: {
  /** Where "Open Solara" goes (a city page opens the app on that city). */
  appHref?: string
  children: ReactNode
}) {
  return (
    <div className="bg-surface">
      <header className="mx-auto flex max-w-[960px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg text-[18px] font-bold text-ink no-underline"
        >
          <SolaraMark size={24} />
          Solara
        </Link>
        <a href={appHref} className="btn px-4 py-2 text-[14px] font-semibold no-underline">
          Open Solara
        </a>
      </header>
      <main className="mx-auto max-w-[960px] px-4 pt-4 pb-16 sm:px-6 md:pt-8">{children}</main>
    </div>
  )
}
