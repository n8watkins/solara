import { expect, test } from '@playwright/test'
import { startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// The location panel opens from a trigger that sits mid-row in the phone header.
// It must clamp itself to the viewport, with every control inside it, down to
// the narrowest phones.

for (const width of [320, 390, 1440]) {
  test(`location panel stays on screen at ${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'layout check runs once')
    await page.setViewportSize({ width, height: 800 })
    await startClock(page)
    await page.goto('/harness/?screen=dashboard')
    await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', 'dashboard')

    await page.getByRole('button', { name: /Los Angeles/ }).click()
    const panel = page.getByText('Location', { exact: true }).locator('..')
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)

    for (const control of await panel.locator('button, input').all()) {
      const inner = await control.boundingBox()
      if (!inner) continue
      expect(inner.x).toBeGreaterThanOrEqual(box!.x)
      expect(inner.x + inner.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)
    }
  })
}
