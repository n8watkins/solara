'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type {
  AnalyticsConsent as AnalyticsConsentValue} from '@/lib/analytics-consent';
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  readAnalyticsConsent,
} from '@/lib/analytics-consent'

function announceConsent(consent: Exclude<AnalyticsConsentValue, 'unset'>) {
  persistAnalyticsConsent(window.localStorage, consent)
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: consent }))
}

function useAnalyticsConsent() {
  const [consent, setConsent] = useState<AnalyticsConsentValue | null>(null)

  useEffect(() => {
    setConsent(readAnalyticsConsent(window.localStorage))

    const handleConsent = (event: Event) => {
      setConsent(parseAnalyticsConsent((event as CustomEvent<string>).detail))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ANALYTICS_CONSENT_STORAGE_KEY) {
        setConsent(parseAnalyticsConsent(event.newValue))
      }
    }

    window.addEventListener(ANALYTICS_CONSENT_EVENT, handleConsent)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, handleConsent)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return consent
}

export default function AnalyticsConsent({ measurementId }: { measurementId?: string }) {
  const consent = useAnalyticsConsent()
  const pathname = usePathname()
  const hasPageLevelControls = pathname === '/privacy' || pathname === '/privacy/'
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (consent !== 'unset' || hasPageLevelControls || !dialogRef.current) return
    const dialog = dialogRef.current
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]'))
    focusable[0]?.focus()

    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        announceConsent('declined')
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.key !== 'Tab' || !first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInDialog)
    return () => document.removeEventListener('keydown', keepFocusInDialog)
  }, [consent, hasPageLevelControls])

  if (!measurementId) return null

  return (
    <>
      {consent === 'accepted' && (
        <>
          <Script id="ga-consent-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${measurementId}');`}
          </Script>
          <Script
            id="ga-library"
            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
            strategy="afterInteractive"
          />
        </>
      )}

      {consent === 'unset' && !hasPageLevelControls && (
        <div className="analytics-consent-backdrop">
          <section
            ref={dialogRef}
            className="analytics-consent-banner"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-consent-title"
          >
            <div>
              <h2 id="analytics-consent-title">Help improve Solara</h2>
              <p>
                Allow optional analytics to help us understand which features are useful.
                No analytics loads unless you choose Allow.
              </p>
            </div>
            <div className="analytics-consent-actions">
              <button className="btn btn-primary" type="button" onClick={() => announceConsent('accepted')}>
                Allow analytics
              </button>
              <button className="btn" type="button" onClick={() => announceConsent('declined')}>
                Not now
              </button>
              <a href="/privacy/">Privacy details</a>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export function AnalyticsPreferenceControl({ enabled }: { enabled: boolean }) {
  const consent = useAnalyticsConsent()

  if (!enabled) {
    return <p>Optional analytics is not configured for this deployment.</p>
  }

  const choose = (nextConsent: Exclude<AnalyticsConsentValue, 'unset'>) => {
    const shouldReload = consent === 'accepted' && nextConsent === 'declined'
    announceConsent(nextConsent)
    if (shouldReload) window.location.reload()
  }

  const status = consent === 'accepted'
    ? 'Allowed'
    : consent === 'declined'
      ? 'Not allowed'
      : 'No choice saved'

  return (
    <div className="analytics-preference" aria-labelledby="analytics-preference-title">
      <h3 id="analytics-preference-title">Optional analytics</h3>
      <p>
        Current choice: <strong role="status">{status}</strong>.
        You can change this at any time.
      </p>
      <div className="analytics-preference-actions">
        <button
          className="btn btn-primary"
          type="button"
          aria-pressed={consent === 'accepted'}
          onClick={() => choose('accepted')}
        >
          Allow analytics
        </button>
        <button
          className="btn"
          type="button"
          aria-pressed={consent === 'declined'}
          onClick={() => choose('declined')}
        >
          Do not allow
        </button>
      </div>
    </div>
  )
}
