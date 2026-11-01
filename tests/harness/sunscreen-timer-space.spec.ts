import { expect, test, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'

// The sunscreen timer loads after the page (components/deferred.tsx SunscreenTimer) and
// keeps its place until then, so nothing below it moves when it appears. Its text runs
// longer in Spanish than in English, so the place must be as tall as the idle card in
// every language and at every width: here it is measured as the page opens, then
// compared with the card that replaces it.

const widths = (t: TestInfo) => (t.project.name.startsWith('mobile') ? [320, 390] : [768, 1280])

const LANGUAGES = [
  { code: 'en', region: /^Sunscreen timer$/ },
  { code: 'es', region: /^Temporizador de protector solar$/ },
] as const

for (const language of LANGUAGES) {
  test(`the sunscreen timer opens without moving the page in ${language.code}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.endsWith('dark'), 'Layout only: the light projects cover it.')
    await preparePage(page, testInfo)
    await page.addInitScript(code => {
      try {
        window.localStorage.setItem('solara_language', code)
      } catch {}
      // Every height the placeholder takes, and where the content below it starts.
      const seen: { height: number; below: number | null }[] = []
      Object.assign(window, { __timerSpace: seen })
      const observed = new WeakSet<Element>()
      new MutationObserver(() => {
        const space = document.querySelector('[data-testid="sunscreen-timer-space"]')
        if (!space || observed.has(space)) return
        observed.add(space)
        new ResizeObserver(() => {
          // Taken off the page: its last size was the one it held.
          if (!space.isConnected) return
          const next = space.nextElementSibling?.getBoundingClientRect().top
          seen.push({
            height: space.getBoundingClientRect().height,
            below: next === undefined ? null : next + window.scrollY,
          })
        }).observe(space)
      }).observe(document, { childList: true, subtree: true })
    }, language.code)

    for (const width of widths(testInfo)) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/harness/?screen=dashboard&tier=guest')
      const timer = page.getByRole('region', { name: language.region })
      await expect(timer).toBeVisible()
      const space = await page.evaluate(
        () =>
          (window as unknown as { __timerSpace: { height: number; below: number | null }[] })
            .__timerSpace,
      )
      expect(space.length, `the placeholder showed at ${width} px`).toBeGreaterThan(0)
      const before = space.at(-1)!
      const after = await timer.evaluate(el => {
        const next = el.nextElementSibling?.getBoundingClientRect().top
        return {
          height: el.getBoundingClientRect().height,
          below: next === undefined ? null : next + window.scrollY,
        }
      })
      expect(
        Math.abs(after.height - before.height),
        `${language.code} at ${width} px: the card is ${after.height} px, its place ${before.height} px`,
      ).toBeLessThanOrEqual(0.5)
      if (before.below !== null && after.below !== null) {
        expect(
          Math.abs(after.below - before.below),
          `what follows moved at ${width} px`,
        ).toBeLessThanOrEqual(0.5)
      }
    }
  })
}
