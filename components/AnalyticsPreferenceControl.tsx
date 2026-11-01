'use client'

import type { Locale } from '@solara/core/i18n'
import type { AnalyticsConsent as AnalyticsConsentValue } from '@/lib/analytics-consent'
import { clearAnalyticsCookies } from '@/lib/ga'
import { announceConsent, useAnalyticsConsent } from './AnalyticsConsent'

/** The words in each language the privacy policy is written in. */
const COPY = {
  en: {
    notConfigured: 'Optional analytics is not configured for this deployment.',
    title: 'Optional analytics',
    current: 'Current choice:',
    canChange: 'You can change this at any time.',
    allowed: 'Allowed',
    notAllowed: 'Not allowed',
    noChoice: 'No choice saved',
    allow: 'Allow analytics',
    doNotAllow: 'Do not allow',
  },
  es: {
    notConfigured: 'Las analíticas opcionales no están configuradas en esta versión.',
    title: 'Analíticas opcionales',
    current: 'Elección actual:',
    canChange: 'Puedes cambiarla cuando quieras.',
    allowed: 'Permitidas',
    notAllowed: 'No permitidas',
    noChoice: 'Ninguna elección guardada',
    allow: 'Permitir analíticas',
    doNotAllow: 'No permitir',
  },
} satisfies Record<Locale, Record<string, string>>

/**
 * The privacy page's analytics choice, which can be changed at any time. Its own module,
 * so the banner every page carries (AnalyticsConsent) stays small.
 */
export default function AnalyticsPreferenceControl({
  enabled,
  locale = 'en',
}: {
  enabled: boolean
  locale?: Locale
}) {
  const consent = useAnalyticsConsent()
  const t = COPY[locale]

  if (!enabled) {
    return <p>{t.notConfigured}</p>
  }

  const choose = (nextConsent: Exclude<AnalyticsConsentValue, 'unset'>) => {
    const shouldReload = consent === 'accepted' && nextConsent === 'declined'
    announceConsent(nextConsent)
    if (nextConsent === 'declined') clearAnalyticsCookies(document, window.location.hostname)
    // gtag.js cannot be unloaded, so a reload guarantees it stops running.
    if (shouldReload) window.location.reload()
  }

  const status =
    consent === 'accepted' ? t.allowed : consent === 'declined' ? t.notAllowed : t.noChoice

  return (
    <div className="analytics-preference" aria-labelledby="analytics-preference-title">
      <h3 id="analytics-preference-title">{t.title}</h3>
      <p>
        {t.current} <strong role="status">{status}</strong>. {t.canChange}
      </p>
      <div className="analytics-preference-actions">
        <button
          className="btn"
          type="button"
          aria-pressed={consent === 'accepted'}
          onClick={() => choose('accepted')}
        >
          {t.allow}
        </button>
        <button
          className="btn"
          type="button"
          aria-pressed={consent === 'declined'}
          onClick={() => choose('declined')}
        >
          {t.doNotAllow}
        </button>
      </div>
    </div>
  )
}
