export const ANALYTICS_CONSENT_STORAGE_KEY = 'solara.analytics-consent.v1'
export const ANALYTICS_CONSENT_EVENT = 'solara:analytics-consent-changed'

export type AnalyticsConsent = 'accepted' | 'declined' | 'unset'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function isAnalyticsMeasurementId(value: string | undefined): value is string {
  return Boolean(value && /^G-[A-Z0-9]+$/.test(value))
}

export function parseAnalyticsConsent(value: string | null): AnalyticsConsent {
  return value === 'accepted' || value === 'declined' ? value : 'unset'
}

export function readAnalyticsConsent(storage: StorageReader): AnalyticsConsent {
  try {
    return parseAnalyticsConsent(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY))
  } catch {
    return 'unset'
  }
}

export function persistAnalyticsConsent(
  storage: StorageWriter,
  consent: Exclude<AnalyticsConsent, 'unset'>,
): boolean {
  try {
    storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent)
    return true
  } catch {
    return false
  }
}

/** The `<html>` attribute the head script sets: the stored choice, or 'unset'. */
export const ANALYTICS_CONSENT_ATTRIBUTE = 'data-analytics-consent'

// Runs in <head> before first paint on pages that can ask (GA configured), so the
// consent banner, which is in the page flow, is laid out from the first frame instead
// of pushing the page down after hydration. Plain ES5, a fixed literal (its CSP hash
// is computed at build time), and it never throws.
export const ANALYTICS_CONSENT_INIT_SCRIPT = `(function(){var c=null;try{c=localStorage.getItem("solara.analytics-consent.v1")}catch(e){}try{document.documentElement.setAttribute("data-analytics-consent",c==='accepted'||c==='declined'?c:'unset')}catch(e){}})()`

/** Records the choice on `<html>`, so the banner hides at once (see the init script). */
export function markAnalyticsConsent(root: Element, consent: AnalyticsConsent) {
  root.setAttribute(ANALYTICS_CONSENT_ATTRIBUTE, consent)
}

/**
 * Pages that never ask: the landing page and the city pages ship no framework
 * JavaScript (scripts/static-pages.mjs), so they load no analytics to ask about, and
 * the privacy page has its own controls.
 */
export function asksForAnalyticsConsent(pathname: string | null): boolean {
  if (!pathname || pathname === '/') return false
  return !/^\/(uv|privacy)(\/|$)/.test(pathname)
}
