import { describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_CONSENT_INIT_SCRIPT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  asksForAnalyticsConsent,
  isAnalyticsMeasurementId,
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  readAnalyticsConsent,
} from './analytics-consent'

describe('analytics consent', () => {
  it('accepts only valid GA4 measurement IDs', () => {
    expect(isAnalyticsMeasurementId('G-ABC123')).toBe(true)
    expect(isAnalyticsMeasurementId('UA-123')).toBe(false)
    expect(isAnalyticsMeasurementId("G-ABC';alert(1)//")).toBe(false)
    expect(isAnalyticsMeasurementId(undefined)).toBe(false)
  })

  it('treats unknown and missing values as unset', () => {
    expect(parseAnalyticsConsent(null)).toBe('unset')
    expect(parseAnalyticsConsent('')).toBe('unset')
    expect(parseAnalyticsConsent('granted')).toBe('unset')
    expect(parseAnalyticsConsent('accepted')).toBe('accepted')
    expect(parseAnalyticsConsent('declined')).toBe('declined')
  })

  it('fails closed when storage cannot be read', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    }

    expect(readAnalyticsConsent(storage)).toBe('unset')
  })

  it('persists an explicit decision and reports storage failures', () => {
    const workingStorage = { setItem: vi.fn() }
    const blockedStorage = {
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    }

    expect(persistAnalyticsConsent(workingStorage, 'accepted')).toBe(true)
    expect(workingStorage.setItem).toHaveBeenCalledWith(ANALYTICS_CONSENT_STORAGE_KEY, 'accepted')
    expect(persistAnalyticsConsent(blockedStorage, 'declined')).toBe(false)
  })

  it('asks only on pages that run the app code', () => {
    expect(asksForAnalyticsConsent('/app/')).toBe(true)
    expect(asksForAnalyticsConsent('/account/')).toBe(true)
    expect(asksForAnalyticsConsent('/terms/')).toBe(true)
    expect(asksForAnalyticsConsent('/')).toBe(false)
    expect(asksForAnalyticsConsent('/uv/')).toBe(false)
    expect(asksForAnalyticsConsent('/uv/los-angeles/')).toBe(false)
    expect(asksForAnalyticsConsent('/privacy/')).toBe(false)
    expect(asksForAnalyticsConsent('/privacy')).toBe(false)
    expect(asksForAnalyticsConsent(null)).toBe(false)
  })

  it('marks the stored choice on <html> before first paint, and never throws', () => {
    const run = (stored: string | null | Error) => {
      const attributes = new Map<string, string>()
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => {
          if (stored instanceof Error) throw stored
          return key === ANALYTICS_CONSENT_STORAGE_KEY ? stored : null
        },
      })
      vi.stubGlobal('document', {
        documentElement: { setAttribute: (k: string, v: string) => attributes.set(k, v) },
      })
      new Function(ANALYTICS_CONSENT_INIT_SCRIPT)()
      vi.unstubAllGlobals()
      return attributes.get('data-analytics-consent')
    }
    expect(run(null)).toBe('unset')
    expect(run('accepted')).toBe('accepted')
    expect(run('declined')).toBe('declined')
    expect(run('granted')).toBe('unset')
    expect(run(new Error('blocked'))).toBe('unset')
    expect(ANALYTICS_CONSENT_INIT_SCRIPT).toContain(JSON.stringify(ANALYTICS_CONSENT_STORAGE_KEY))
    expect(ANALYTICS_CONSENT_INIT_SCRIPT).not.toMatch(/<\/|<!--/)
  })
})
