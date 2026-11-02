'use client'
import { useEffect } from 'react'
import './globals.css'
import { inter } from './fonts'
import { reportError } from '@/lib/error-reporting'
import { getStoredTheme } from '@/lib/theme'
import StaticText from '@/components/StaticText'
import * as staticText from '@/messages/crash'

/**
 * Last-resort error screen: replaces the root layout when it fails to render. It has
 * its own document, so it brings the global styles and the stored theme itself.
 */
// This page replaces the whole document, so it sets <html lang> again from the language
// the page opened in (lib/i18n.ts LANGUAGE_INIT_SCRIPT) and writes its words in every
// language (StaticText), with no catalogue to load.
function pageLanguage(): 'en' | 'es' {
  return typeof document !== 'undefined' && document.documentElement.lang === 'es' ? 'es' : 'en'
}

function crashTitle(): string {
  return staticText.crashTitle[pageLanguage()]
}

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // A no-op unless the build has a Sentry DSN (lib/error-reporting.ts).
    reportError(error, { source: 'global-error' })
  }, [error])

  const theme = getStoredTheme()

  return (
    <html
      lang={pageLanguage()}
      // Without clsx, which the crash page would otherwise be alone in carrying.
      className={theme === 'dark' ? `${inter.variable} dark` : inter.variable}
      style={{ colorScheme: theme }}
    >
      <body>
        <title>{crashTitle()}</title>
        <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-6">
          <div className="card w-full max-w-[480px] px-[26px] py-8 text-center">
            <p className="mb-3 text-[42px]" aria-hidden="true">
              🌥️
            </p>
            <h1 className="mb-2.5 text-[26px] font-[750] text-ink">
              <StaticText text={staticText.crashHeading} />
            </h1>
            <p className="mb-[22px] text-[15px] leading-[1.55] text-ink-2">
              <StaticText text={staticText.crashBody} />
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button className="btn btn-primary" onClick={() => retry()}>
                <StaticText text={staticText.tryAgain} />
              </button>
              <button className="btn" onClick={() => window.location.reload()}>
                <StaticText text={staticText.reloadApp} />
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
