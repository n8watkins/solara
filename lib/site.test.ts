import { afterEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  const site = await import('./site')
  const { default: robots } = await import('@/app/robots')
  return { ...site, robots: robots() }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('site', () => {
  it('lets search engines crawl production and points them at its sitemap', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://solara-uv.web.app/')
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENVIRONMENT', '')
    const { SITE_URL, IS_STAGING, robots } = await load()
    expect(SITE_URL).toBe('https://solara-uv.web.app')
    expect(IS_STAGING).toBe(false)
    expect(robots).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://solara-uv.web.app/sitemap.xml',
    })
  })

  it('keeps a staging build out of search engines', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://solara-staging.web.app')
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENVIRONMENT', 'staging')
    const { IS_STAGING, robots } = await load()
    expect(IS_STAGING).toBe(true)
    expect(robots).toEqual({ rules: { userAgent: '*', disallow: '/' } })
  })
})

describe('share links', () => {
  it("fall back to the build's own site, not production's", async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://solara-staging.web.app')
    vi.resetModules()
    const { buildActivityShareUrl } = await import('./share')
    const url = buildActivityShareUrl({
      activity: { name: 'Run', icon: 'run', durationMins: 30 } as never,
      window: { from: 7, to: 8, peakUV: 2 } as never,
      location: { city: 'Austin', region: 'TX' } as never,
      isoDate: '2026-10-28',
      dateLabel: 'Today',
    })
    expect(url.startsWith('https://solara-staging.web.app/share/?')).toBe(true)
  })
})
