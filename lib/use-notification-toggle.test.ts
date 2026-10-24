import { describe, expect, it } from 'vitest'
import { notificationStatus } from '@/lib/use-notification-toggle'

describe('notificationStatus', () => {
  it('is enabled only with permission and a subscription on this device', () => {
    expect(notificationStatus('granted', true)).toBe('enabled')
    expect(notificationStatus('granted', false)).toBe('default')
  })

  it('offers to turn notifications on while the browser has not been asked', () => {
    expect(notificationStatus('default', false)).toBe('default')
  })

  it('is blocked when the person denied permission or the browser has no API', () => {
    expect(notificationStatus('denied', false)).toBe('blocked')
    expect(notificationStatus(null, false)).toBe('blocked')
  })
})
