'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AnalyticsConsent as AnalyticsConsentValue } from '@/lib/analytics-consent'
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

/** Records a choice: in this browser, on <html> (which hides the banner) and for listeners. */
export function announceConsent(consent: Exclude<AnalyticsConsentValue, 'unset'>) {
  persistAnalyticsConsent(window.localStorage, consent)
  markAnalyticsConsent(document.documentElement, consent)
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: consent }))
}

/** The stored choice, null until hydration; follows changes here and in other tabs. */
export function useAnalyticsConsent() {
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

/** GA4 itself and the cookie clean-up, loaded only when there is something to do. */
const loadRuntime = () => import('@/lib/analytics-runtime')

/**
 * Cookies gtag.js may have left (isAnalyticsCookie in lib/ga.ts names them exactly):
 * they are removed when someone has not allowed analytics.
 */
const LEFTOVER_ANALYTICS_COOKIE = /(?:^|;\s*)_g(?:a|id|at)/

export default function AnalyticsConsent({ measurementId }: { measurementId?: string }) {
  const consent = useAnalyticsConsent()
  const pathname = usePathname()

  useEffect(() => {
    if (!measurementId || consent === null) return
    // Without consent there is nothing to do unless analytics already ran here (a choice
    // changed in another tab) or left cookies behind.
    if (
      consent !== 'accepted' &&
      !window.gtag &&
      !LEFTOVER_ANALYTICS_COOKIE.test(document.cookie)
    ) {
      return
    }
    let current = true
    loadRuntime().then(
      runtime => {
        if (current) runtime.applyAnalyticsConsent(measurementId, consent)
      },
      error => console.error('Could not load analytics:', error),
    )
    return () => {
      current = false
    }
  }, [consent, measurementId])

  // Keep the page URL current for later events, still without the query string.
  useEffect(() => {
    if (consent === 'accepted' && window.gtag) {
      loadRuntime().then(
        runtime => runtime.updateAnalyticsPage(),
        () => {},
      )
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
