import type { Metadata } from 'next'
import { MICROSOFT_REDIRECT_SCRIPT } from '@/lib/microsoft-redirect'

// Where Microsoft sends the Outlook sign-in popup back (docs/integrations/OUTLOOK.md). The
// exported page keeps only its own inline script (scripts/static-pages.mjs strips the
// framework's), so the sign-in code in the address never reaches analytics, Firebase or
// any other script: the script hands it to the app's window and closes the popup. The
// app-shell service worker leaves this page to the network (lib/sw-shell.mts).

export const metadata: Metadata = {
  title: 'Connecting Outlook | Solara',
  robots: { index: false, follow: false },
}

export default function MicrosoftRedirectPage() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-surface px-4">
      <script data-static="" dangerouslySetInnerHTML={{ __html: MICROSOFT_REDIRECT_SCRIPT }} />
      <div className="max-w-sm text-center">
        <h1 className="text-[17px] font-semibold text-ink">Connecting Outlook</h1>
        <p className="mt-1.5 text-[14px] leading-normal text-ink-2">
          You can close this window and go back to Solara.
        </p>
      </div>
    </main>
  )
}
