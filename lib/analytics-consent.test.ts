import { describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
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
})
