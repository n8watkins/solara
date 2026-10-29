// The opt-in analytics itself (components/AnalyticsConsent.tsx): starts GA4 for
// someone who allowed it, or turns it off and removes its cookies. It loads on demand,
// only when there is something to do, so it is not part of any page's first load.
import { clearAnalyticsCookies, GTAG_CONSENT_DEFAULTS, gtagConfig, gtagPageParams } from './ga'
import type { AnalyticsConsent } from './analytics-consent'

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

/** Starts analytics for 'accepted'; otherwise stops it and removes its cookies. */
export function applyAnalyticsConsent(measurementId: string, consent: AnalyticsConsent) {
  setAnalyticsDisabled(measurementId, consent !== 'accepted')
  if (consent === 'accepted') startAnalytics(measurementId)
  else clearAnalyticsCookies(document, window.location.hostname)
}

/** Keeps the page URL current for later events, still without the query string. */
export function updateAnalyticsPage() {
  window.gtag?.('set', { page_location: gtagPageParams(window.location.href, '').page_location })
}
