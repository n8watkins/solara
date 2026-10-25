'use client'
import { X } from 'lucide-react'
import SolaraMark from './SolaraMark'
import { useEffect, useState, type ReactNode } from 'react'
import {
  ANALYTICS_CONSENT_EVENT,
  isAnalyticsMeasurementId,
  readAnalyticsConsent,
} from '@/lib/analytics-consent'
import { INSTALL_DISMISS_KEY, installPromptKind } from '@/lib/install-prompt'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** The iOS share glyph (box with an up-arrow) so the instruction reads at a glance. */
function ShareIcon() {
  return (
    <svg
      width="11"
      height="13"
      viewBox="0 0 16 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline align-[-1px]"
    >
      <path d="M8 1.5 V11" />
      <path d="M5 4 L8 1 L11 4" />
      <path d="M4 8 H2.5 A1.5 1.5 0 0 0 1 9.5 V16.5 A1.5 1.5 0 0 0 2.5 18 H13.5 A1.5 1.5 0 0 0 15 16.5 V9.5 A1.5 1.5 0 0 0 13.5 8 H12" />
    </svg>
  )
}

/**
 * "Add to home screen" prompt. Two paths:
 *  - Chromium (Android/desktop): capture the deferred `beforeinstallprompt` event
 *    and offer a one-tap Install button.
 *  - iOS Safari: that event never fires and install can't be triggered
 *    programmatically, so surface the manual Share, then Add to Home Screen
 *    instructions instead.
 * Hidden if already installed (standalone), already dismissed, or unsupported.
 *
 * It floats over the bottom of the page rather than taking a place in it: it appears
 * once the browser allows installing, after the page has drawn, and must not push
 * what is on screen down. It waits while the analytics banner, which sits in the
 * same place, asks for a choice.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<'chromium' | 'ios' | null>(null)
  const consentPending = useAnalyticsBannerOpen()

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = Boolean(localStorage.getItem(INSTALL_DISMISS_KEY))
    } catch {}
    const kind = installPromptKind({
      standalone:
        window.matchMedia?.('(display-mode: standalone)').matches ||
        Boolean((window.navigator as { standalone?: boolean }).standalone),
      dismissed,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    })
    if (kind === 'ios') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
      setMode('ios')
      return
    }
    if (kind !== 'chromium') return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setMode('chromium')
    }
    const onInstalled = () => {
      setMode(null)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setMode(null)
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1')
    } catch {}
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setMode(null)
    setDeferred(null)
  }

  if (!mode || consentPending) return null

  if (mode === 'ios') {
    return (
      <Banner onDismiss={dismiss}>
        Tap <ShareIcon /> Share, then <strong>Add to Home Screen</strong> to open Solara in one tap.
      </Banner>
    )
  }

  return (
    <Banner
      onDismiss={dismiss}
      action={
        <button
          className="btn btn-primary shrink-0 px-3.5 py-2 text-[13px]"
          onClick={() => void install()}
        >
          Install
        </button>
      }
    >
      One tap each morning to check your sun window.
    </Banner>
  )
}

const ANALYTICS_CONFIGURED = isAnalyticsMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

/** Whether the analytics consent banner (components/AnalyticsConsent.tsx) is showing. */
function useAnalyticsBannerOpen(): boolean {
  const [open, setOpen] = useState(ANALYTICS_CONFIGURED)
  useEffect(() => {
    if (!ANALYTICS_CONFIGURED) return
    const update = () => setOpen(readAnalyticsConsent(window.localStorage) === 'unset')
    update()
    window.addEventListener(ANALYTICS_CONSENT_EVENT, update)
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, update)
  }, [])
  return open
}

function Banner({
  children,
  action,
  onDismiss,
}: {
  children: ReactNode
  action?: ReactNode
  onDismiss: () => void
}) {
  return (
    <section
      aria-label="Install Solara"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[520px] items-center gap-3 rounded-2xl border-[0.5px] border-line-strong bg-surface-card px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.22)]"
    >
      <SolaraMark size={24} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-[650] text-ink">Add Solara to your home screen</p>
        <p className="mt-0.5 text-[12px] text-ink-3">{children}</p>
      </div>
      {action}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent text-ink-3"
      >
        <X size={17} />
      </button>
    </section>
  )
}
