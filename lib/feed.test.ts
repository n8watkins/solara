import { describe, it, expect } from 'vitest'
import { isFeedConfigured, randomFeedToken, buildFeedUrl, buildWebcalUrl } from '@/lib/feed'

// NEXT_PUBLIC_FUNCTIONS_URL is unset in the test env, so the feed reads as unconfigured.
describe('feed helpers (unconfigured env)', () => {
  it('reports not configured', () => {
    expect(isFeedConfigured()).toBe(false)
  })

  it('returns null URLs when no functions base URL is set', () => {
    expect(buildFeedUrl('a'.repeat(32))).toBeNull()
    expect(buildWebcalUrl('a'.repeat(32))).toBeNull()
  })
})

describe('randomFeedToken', () => {
  it('produces a 32-char URL-safe token accepted by the prefs validator', () => {
    const t = randomFeedToken()
    expect(t).toHaveLength(32)
    expect(t).toMatch(/^[A-Za-z0-9_-]{16,}$/)
  })

  it('is non-repeating across calls', () => {
    expect(randomFeedToken()).not.toBe(randomFeedToken())
  })
})
