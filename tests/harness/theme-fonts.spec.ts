import { expect, test } from '@playwright/test'
import { THEME_STORAGE_KEY } from '../../lib/theme'
import { HARNESS_MARKER } from './fixtures'

// Theme and font behavior on the real static export (REPORT UX-8, FE-6, PERF-4).
// Runs once per color scheme on desktop; layout does not matter here.
test.describe('theme and fonts', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop-'), 'scheme-level check, desktop only')
  })

  test('the theme follows the system by default and is set before any app code runs', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
    // Block every script bundle: only the blocking inline head script can run, so
    // a correct class proves there is no flash waiting for hydration.
    await page.route('**/_next/static/chunks/**', route => route.abort())
    await page.goto('/harness/?screen=dashboard')
    const html = page.locator('html')
    if (scheme === 'dark') await expect(html).toHaveClass(/\bdark\b/)
    else await expect(html).not.toHaveClass(/\bdark\b/)
    expect(await html.evaluate(el => (el as HTMLElement).style.colorScheme)).toBe(scheme)
  })

  test('an explicit choice overrides the system theme', async ({ page }, testInfo) => {
    const scheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
    const opposite = scheme === 'dark' ? 'light' : 'dark'
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [THEME_STORAGE_KEY, opposite],
    )
    await page.route('**/_next/static/chunks/**', route => route.abort())
    await page.goto('/harness/?screen=dashboard')
    const html = page.locator('html')
    if (opposite === 'dark') await expect(html).toHaveClass(/\bdark\b/)
    else await expect(html).not.toHaveClass(/\bdark\b/)
  })

  test('Inter is self-hosted: no third-party font request, every weight available', async ({
    page,
  }) => {
    const offOrigin: string[] = []
    const fontFiles: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.protocol !== 'data:' && url.hostname !== '127.0.0.1') offOrigin.push(url.href)
      if (request.resourceType() === 'font') fontFiles.push(url.href)
    })
    await page.goto('/harness/?screen=dashboard')
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    expect(offOrigin).toEqual([])
    expect(fontFiles.length).toBeGreaterThan(0)
    // next/font gives the face a generated family name; read it from the variable.
    const family = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--font-inter')
        .split(',')[0]!
        .trim()
        .replace(/['"]/g, ''),
    )
    expect(family).toMatch(/inter/i)
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(family)
    // One variable face covers every weight the UI uses, bold included (REPORT UX-8).
    const faces = await page.evaluate(
      name =>
        [...document.fonts]
          .filter(face => face.family.replace(/['"]/g, '') === name && face.status === 'loaded')
          .map(face => face.weight),
      family,
    )
    expect(faces.length).toBeGreaterThan(0)
    expect(new Set(faces)).toEqual(new Set(['100 900']))
  })
})
