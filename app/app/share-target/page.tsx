import type { Metadata } from 'next'
import LocalizedTitle from '@/components/LocalizedTitle'
import StaticText from '@/components/StaticText'
import * as staticText from '@/messages/static'

export const metadata: Metadata = {
  title: staticText.shareAgainPageTitle.en,
  robots: { index: false, follow: false },
}

// Where the share sheet posts a shared calendar file or link (the manifest's
// share_target). The app-shell service worker answers that POST itself
// (lib/share-target.ts), so this page shows only when no worker of this version runs
// yet: the first moments after installing, or a worker from before sharing existed.
// Hosting serves it to the POST, which it cannot read; opening the app installs the
// worker, and sharing again works. No script: the app's layout registers the worker.
export default function ShareTargetFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-6">
      <LocalizedTitle title={staticText.shareAgainPageTitle} />
      <div className="card w-full max-w-[480px] px-[26px] py-8 text-center">
        <p className="mb-3 text-[42px]" aria-hidden="true">
          🌤️
        </p>
        <h1 className="mb-2.5 text-[26px] font-[750] text-ink">
          <StaticText text={staticText.shareAgainTitle} />
        </h1>
        <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
          <StaticText text={staticText.shareAgainBody} />
        </p>
        <a href="/app/" className="btn btn-primary justify-center px-[18px] py-[11px] no-underline">
          <StaticText text={staticText.openSolara} />
        </a>
      </div>
    </main>
  )
}
