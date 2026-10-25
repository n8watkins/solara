import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { freezeScreen } from './freeze'
import { currentFromHour, prepareLiveDashboard } from './live-forecast'

// Regenerates the landing page's screenshots (public/landing/) from the harness, so
// the landing page always shows the real app. Skipped unless asked for:
//
//   UPDATE_LANDING_SHOTS=1 npm run test:harness -- landing-shots --project=mobile-light --project=mobile-dark
//
// A Free account's dashboard on a 390 px phone, the top of the page only, as WebP.
// Keep the size in sync with the <img> in app/page.tsx. One coherent sample day: the
// readout shows the 10am forecast that the highlighted bar shows, and the plan is a
// run and tennis, so the lead slot (a 6pm run, peak UV 3.1) is plainly lower-UV.
export const LANDING_SHOT = { width: 390, height: 676 }

test.skip(!process.env.UPDATE_LANDING_SHOTS, 'Set UPDATE_LANDING_SHOTS=1 to regenerate.')

test('landing page screenshot', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone screenshots only.')
  // The upsells are for real visitors, not the marketing shot.
  await page.addInitScript(() => {
    localStorage.setItem(
      'solara_upsells_dismissed',
      JSON.stringify({ 'morning-alert': '2026-06-15T00:00:00.000Z' }),
    )
  })
  const capture = await prepareLiveDashboard(page, testInfo, {
    tier: 'free',
    edit: currentFromHour(10),
    query: '&activities=run,tennis',
  })
  await expect(page.getByTestId('hero-slot')).toHaveAttribute('data-activity', 'run')
  await expect(page.getByTestId('uv-readout')).toContainText('6.0')
  await freezeScreen(page, capture.startedAt)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  const png = await page.screenshot({
    clip: { x: 0, y: 0, ...LANDING_SHOT },
    animations: 'disabled',
    caret: 'hide',
  })
  // Chromium encodes the WebP, so this needs no image library.
  const webp = await page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d')!.drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp', 0.82).split(',')[1]!
  }, png.toString('base64'))
  const dir = join('public', 'landing')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `dashboard-${capture.colorScheme}.webp`), Buffer.from(webp, 'base64'))
})
