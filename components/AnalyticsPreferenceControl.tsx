'use client'

import type { AnalyticsConsent as AnalyticsConsentValue } from '@/lib/analytics-consent'
import { clearAnalyticsCookies } from '@/lib/ga'
import { announceConsent, useAnalyticsConsent } from './AnalyticsConsent'

/**
 * The privacy page's analytics choice, which can be changed at any time. Its own module,
 * so the banner every page carries (AnalyticsConsent) stays small.
 */
export default function AnalyticsPreferenceControl({ enabled }: { enabled: boolean }) {
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
