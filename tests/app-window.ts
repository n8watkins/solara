// Runs a page as an installed app's own window does (display mode standalone), as a
// Trusted Web Activity shows Solara; Playwright cannot emulate display modes. Store mode
// takes `?source=twa` only in such a window (lib/store-build.ts, REVIEW9 SEC9 L8).
import type { Page } from '@playwright/test'

export async function asAppWindow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      const result = original(query)
      if (!/display-mode:\s*standalone/.test(query)) return result
      return new Proxy(result, {
        get: (target, key) => (key === 'matches' ? true : Reflect.get(target, key, target)),
      })
    }
  })
}
