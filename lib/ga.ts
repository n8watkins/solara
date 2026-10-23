/**
 * Google Analytics 4 helpers for the opt-in analytics in AnalyticsConsent.
 *
 * Privacy rules: page URLs and referrers are sent without query strings or
 * fragments (they can hold session ids or share-link text), Google signals and
 * ad personalization are off, ad storage is denied, and the `_ga` cookies are
 * removed when someone declines.
 */

/** A URL reduced to origin and path; anything unparseable becomes an empty string. */
export function stripQuery(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return ''
  }
}

export interface GtagPageParams {
  page_location: string
  page_referrer: string
}

export function gtagPageParams(href: string, referrer: string): GtagPageParams {
  return { page_location: stripQuery(href), page_referrer: stripQuery(referrer) }
}

export const GTAG_CONSENT_DEFAULTS = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted',
} as const

export function gtagConfig(href: string, referrer: string) {
  return {
    ...gtagPageParams(href, referrer),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  }
}

/** True for cookie names GA4's gtag.js sets (`_ga`, `_ga_<id>`, `_gid`, `_gat*`). */
export function isAnalyticsCookie(name: string): boolean {
  return name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name.startsWith('_gat')
}

/** Every domain a cookie for `hostname` could have been set on, most specific first. */
export function cookieDomains(hostname: string): string[] {
  const parts = hostname.split('.')
  // An IP address or single-label host has no parent domains.
  if (parts.length < 2 || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return [hostname]
  const domains: string[] = []
  for (let i = 0; i < parts.length - 1; i++) domains.push(parts.slice(i).join('.'))
  return domains
}

/**
 * Expire every analytics cookie visible to the page. gtag.js sets them on the
 * broadest domain it may, so each candidate domain is tried along with a
 * host-only cookie; writes for domains that do not apply are ignored by the browser.
 */
export function clearAnalyticsCookies(doc: Pick<Document, 'cookie'>, hostname: string): string[] {
  const names = doc.cookie
    .split(';')
    .map(part => part.split('=')[0]?.trim() ?? '')
    .filter(isAnalyticsCookie)
  const unique = [...new Set(names)]
  const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/'
  for (const name of unique) {
    doc.cookie = `${name}=; ${expiry}`
    for (const domain of cookieDomains(hostname)) {
      doc.cookie = `${name}=; ${expiry}; domain=${domain}`
      doc.cookie = `${name}=; ${expiry}; domain=.${domain}`
    }
  }
  return unique
}
