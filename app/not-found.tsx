import type { Metadata } from 'next'
import StaticText from '@/components/StaticText'
import * as staticText from '@/messages/static'

export const metadata: Metadata = {
  title: 'Page not found | Solara',
  robots: { index: false, follow: false },
}

// Exported as out/404.html, which Firebase Hosting serves with a 404 status for
// any path that has no page.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-6">
      <div className="card w-full max-w-[480px] px-[26px] py-8 text-center">
        <p className="mb-3 text-[42px]" aria-hidden="true">
          🌤️
        </p>
        <h1 className="mb-2.5 text-[26px] font-[750] text-ink">
          <StaticText text={staticText.notFoundTitle} />
        </h1>
        <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
          <StaticText text={staticText.notFoundBody} />
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A full page load, so the landing page sends a signed-in visitor to the app. */}
        <a href="/" className="btn btn-primary justify-center px-[18px] py-[11px] no-underline">
          <StaticText text={staticText.openSolara} />
        </a>
      </div>
    </main>
  )
}
