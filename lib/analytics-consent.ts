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
