'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AnalyticsConsent as AnalyticsConsentValue } from '@/lib/analytics-consent'
import { clearAnalyticsCookies, GTAG_CONSENT_DEFAULTS, gtagConfig, gtagPageParams } from '@/lib/ga'
import styles from './AnalyticsConsent.module.css'
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  asksForAnalyticsConsent,
  markAnalyticsConsent,
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  readAnalyticsConsent,
} from '@/lib/analytics-consent'

function announceConsent(consent: Exclude<AnalyticsConsentValue, 'unset'>) {
  persistAnalyticsConsent(window.localStorage, consent)
  markAnalyticsConsent(document.documentElement, consent)
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: consent }))
}

function useAnalyticsConsent() {
  const [consent, setConsent] = useState<AnalyticsConsentValue | null>(null)

  useEffect(() => {
    const stored = readAnalyticsConsent(window.localStorage)
    // Normally already set by the head script; this keeps the banner right without it.
    markAnalyticsConsent(document.documentElement, stored)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
    setConsent(stored)

    const handleConsent = (event: Event) => {
      setConsent(parseAnalyticsConsent((event as CustomEvent<string>).detail))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ANALYTICS_CONSENT_STORAGE_KEY) {
        const next = parseAnalyticsConsent(event.newValue)
        markAnalyticsConsent(document.documentElement, next)
        setConsent(next)
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

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GTAG_SCRIPT_ID = 'ga-library'

/**
 * Start GA4 without any inline script, so the page CSP needs no hash for it:
 * the dataLayer queue is set up here and gtag.js is loaded from its origin.
 */
function startAnalytics(measurementId: string) {
  if (document.getElementById(GTAG_SCRIPT_ID)) return
  window.dataLayer = window.dataLayer || []
  // gtag.js reads `arguments` objects from the queue, not arrays.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag.js requires the Arguments object.
    window.dataLayer!.push(arguments)
  }
  window.gtag('consent', 'default', GTAG_CONSENT_DEFAULTS)
  window.gtag('js', new Date())
  window.gtag('config', measurementId, gtagConfig(window.location.href, document.referrer))

  const script = document.createElement('script')
  script.id = GTAG_SCRIPT_ID
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  document.head.appendChild(script)
}

/** gtag.js honors `window['ga-disable-<id>']` as a kill switch. */
function setAnalyticsDisabled(measurementId: string, disabled: boolean) {
  ;(window as unknown as Record<string, boolean>)[`ga-disable-${measurementId}`] = disabled
}

export default function AnalyticsConsent({ measurementId }: { measurementId?: string }) {
  const consent = useAnalyticsConsent()
  const pathname = usePathname()

  useEffect(() => {
    if (!measurementId || consent === null) return
    setAnalyticsDisabled(measurementId, consent !== 'accepted')
    if (consent === 'accepted') startAnalytics(measurementId)
    else clearAnalyticsCookies(document, window.location.hostname)
  }, [consent, measurementId])

  // Keep the page URL current for later events, still without the query string.
  useEffect(() => {
    if (consent === 'accepted' && window.gtag) {
      window.gtag('set', { page_location: gtagPageParams(window.location.href, '').page_location })
    }
  }, [consent, pathname])

  // Rendered into the static export too (consent is null until hydration): the head
  // script (ANALYTICS_CONSENT_INIT_SCRIPT) marks <html> with the stored choice, and
  // the stylesheet shows the banner only while that is 'unset', so it is in place from
  // the first frame and never shifts the page.
  if (!measurementId || !asksForAnalyticsConsent(pathname) || (consent && consent !== 'unset')) {
    return null
  }

  // A non-blocking banner at the top of the page, in the page flow: it never covers
  // anything at any width, nothing is focused or trapped, and both choices carry
  // equal visual weight.
  return (
    <section className={styles.banner} aria-labelledby="analytics-consent-title">
      <div className={styles.inner}>
        <div className={styles.copy}>
          <h2 id="analytics-consent-title" className={styles.title}>
            Help improve Solara
          </h2>
          {/* Phones get the short sentence, so the bar stays about two rows tall. */}
          <p className={styles.text}>
            <span className={styles.long}>
              Allow optional analytics to help us understand which features are useful. Nothing
              loads unless you choose Allow.
            </span>
            <span className={styles.short}>Optional analytics, off unless you allow it.</span>{' '}
            <a href="/privacy/">Privacy details</a>
          </p>
        </div>
        <div className={styles.actions}>
          <button className="btn" type="button" onClick={() => announceConsent('accepted')}>
            Allow analytics
          </button>
          <button className="btn" type="button" onClick={() => announceConsent('declined')}>
            Not now
          </button>
        </div>
      </div>
    </section>
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
    if (nextConsent === 'declined') clearAnalyticsCookies(document, window.location.hostname)
    // gtag.js cannot be unloaded, so a reload guarantees it stops running.
    if (shouldReload) window.location.reload()
  }

  const status =
    consent === 'accepted' ? 'Allowed' : consent === 'declined' ? 'Not allowed' : 'No choice saved'

  return (
    <div className="analytics-preference" aria-labelledby="analytics-preference-title">
      <h3 id="analytics-preference-title">Optional analytics</h3>
      <p>
        Current choice: <strong role="status">{status}</strong>. You can change this at any time.
      </p>
      <div className="analytics-preference-actions">
        <button
          className="btn"
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
