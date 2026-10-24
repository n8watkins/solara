'use client'
import clsx from 'clsx'
import { useEffect } from 'react'
import './globals.css'
import { inter } from './fonts'
import { reportError } from '@/lib/error-reporting'
import { getStoredTheme } from '@/lib/theme'

/**
 * Last-resort error screen: replaces the root layout when it fails to render. It has
 * its own document, so it brings the global styles and the stored theme itself.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // A no-op unless the build has a Sentry DSN (lib/error-reporting.ts).
    reportError(error, { source: 'global-error' })
  }, [error])

  const theme = getStoredTheme()

  return (
    <html
      lang="en"
      className={clsx(inter.variable, theme === 'dark' && 'dark')}
      style={{ colorScheme: theme }}
    >
      <body>
        <title>Something went wrong | Solara</title>
        <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-6">
          <div className="card w-full max-w-[480px] px-[26px] py-8 text-center">
            <p className="mb-3 text-[42px]" aria-hidden="true">
              🌥️
            </p>
            <h1 className="mb-2.5 text-[26px] font-[750] text-ink">Something went wrong</h1>
            <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
              Solara hit an unexpected problem. Trying again usually fixes it; your saved settings
              are safe.
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button className="btn btn-primary" onClick={() => retry()}>
                Try again
              </button>
              <button className="btn" onClick={() => window.location.reload()}>
                Reload app
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
