import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Share again | Solara',
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
      <div className="card w-full max-w-[480px] px-[26px] py-8 text-center">
        <p className="mb-3 text-[42px]" aria-hidden="true">
          🌤️
        </p>
        <h1 className="mb-2.5 text-[26px] font-[750] text-ink">Share it again</h1>
        <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
          Solara was still getting ready and did not receive what you shared. Open Solara once, then
          share the calendar file or link again.
        </p>
        <a href="/app/" className="btn btn-primary justify-center px-[18px] py-[11px] no-underline">
          Open Solara
        </a>
      </div>
    </main>
  )
}
