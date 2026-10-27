import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The notice a guest sees after signing in to an account that already existed
// (components/GuestPlanNotice.tsx): the account kept its own plan, and the guest plan's
// activities, place and skin type were not added. lib/session.ts records what was left
// out; here the record is put in place directly. Screenshots and axe reports go to
// test-results/ui-harness/ like the other harness specs.
const RECORD = JSON.stringify({
  uid: 'harness-user',
  replaced: { activities: ['Running', 'Picnic'], place: 'Boston', skinType: 'olive' },
})

test('guest plan notice', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.addInitScript(record => {
    // Once only: the notice removes the record when it shows, and a reload starts clean.
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('solara_guest_replaced', record)
    }
  }, RECORD)
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const notice = page.getByRole('status', { name: 'Welcome back. Your account kept its own plan.' })
  await expect(notice).toBeVisible()
  await expect(notice.getByRole('listitem')).toHaveText([
    'Activities: Running, Picnic',
    'Place: Boston',
    'Skin type: Olive',
  ])
  await captureScreen(page, testInfo, capture, { name: 'guest-plan-notice', fullPage: false })

  // Shown once: the record is gone, and "Got it" puts the notice away.
  expect(await page.evaluate(() => localStorage.getItem('solara_guest_replaced'))).toBeNull()
  await notice.getByRole('button', { name: 'Got it' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByText('Welcome back')).toHaveCount(0)
})

test('no notice for a guest, or without a record', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await page.addInitScript(record => localStorage.setItem('solara_guest_replaced', record), RECORD)
  await page.goto('/harness/?screen=dashboard&tier=guest')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('button', { name: /Today/ }).first()).toBeVisible()
  await expect(page.getByText('Welcome back')).toHaveCount(0)
})
