import { expect, test, type Page } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The app store build (lib/store-build.ts, docs/integrations/ANDROID.md): inside a
// Trusted Web Activity, Solara shows no price, upsell or checkout, as Play's payments
// policy asks of an app that does not sell through Play. Each surface that offers Pro on
// the web is checked with `?source=twa` (a TWA's start URL; its `android-app://`
// referrer is covered by lib/store-build.test.ts), next to the same screen on the web.

/**
 * Words that offer Pro or name a price anywhere on the page. Saying what Pro includes
 * ("Coming soon with Pro") is not an offer; a way to buy it is.
 */
const OFFER =
  /\$\d|waitlist|See Pro|See it now with Pro|Go Pro|Upgrade to Pro|Start free trial|Manage subscription|through Stripe|Get this as a morning/i

async function open(page: Page, query: string, store = true) {
  await page.goto(`/harness/?${query}${store ? '&source=twa' : ''}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
}

async function expectNoOffer(page: Page) {
  await expect(page.locator('body')).not.toHaveText(OFFER, { useInnerText: true })
}

test('the web shows the Pro offers this spec looks for', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=dashboard&tier=free', false)
  await expect(page.getByRole('button', { name: 'See the next 10 days with Pro' })).toBeVisible()
  await expect(page.locator('body')).toHaveText(OFFER, { useInnerText: true })
})

test('a guest is offered free sign-in only', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await open(page, 'screen=pricing&tier=guest')
  const dialog = page.getByRole('dialog', { name: 'Sign in free' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Sign in free/ }).first()).toBeVisible()
  await expect(dialog.getByRole('columnheader', { name: 'Pro' })).toHaveCount(0)
  await expect(dialog.getByRole('columnheader', { name: 'Free' })).toBeVisible()
  await expectNoOffer(page)
  await captureScreen(page, testInfo, capture, { name: 'store-sign-in', fullPage: false })
})

test('a guest dashboard has no locked days or Pro offers', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=dashboard&tier=guest')
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  await expect(page.getByRole('button', { name: 'See the next 10 days with Pro' })).toHaveCount(0)
  await expectNoOffer(page)
})

test('a Free dashboard, its profiles and its events offer nothing to buy', async ({
  page,
}, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=dashboard&tier=free&events=sample&subscriptions=on')
  await expect(page.getByTestId('hero-slot')).toBeVisible()
  await expect(page.getByRole('button', { name: 'See the next 10 days with Pro' })).toHaveCount(0)
  await expect(page.getByText('Get this as a morning')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tomorrow' }).first()).toBeVisible()
  await expectNoOffer(page)

  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Profile:/ })
    .click()
  const profiles = page.getByRole('dialog', { name: 'Profiles' })
  await expect(profiles).toBeVisible()
  await expect(profiles.getByText('Family profiles come with Pro')).toHaveCount(0)
  await expectNoOffer(page)
})

test('the Free calendar has no Pro note', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=calendar&tier=free')
  await expect(page.getByText('Go Pro for the full 10-day Calendar view.')).toHaveCount(0)
  await expectNoOffer(page)
})

test('Free settings have no way to Pro', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  for (const tab of ['alerts', 'account']) {
    await open(page, `screen=settings&tier=free&tab=${tab}`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: /See Pro plans|On waitlist/ })).toHaveCount(0)
    await expectNoOffer(page)
  }
})

test('a guest in settings may sign in free, nothing more', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=settings&tier=guest&tab=account')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Sign in free' }).click()
  await expect(page.getByRole('dialog', { name: 'Sign in free' })).toBeVisible()
  await expectNoOffer(page)
})

test('a signed-in account never sees the plans dialog', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=pricing&tier=free')
  await expect(page.getByRole('dialog', { name: 'Solara Pro' })).toHaveCount(0)
  await expectNoOffer(page)
})

test('Pro bought on the web shows, without the Stripe portal', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await page.goto('/harness/account/?state=pro&source=twa')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByText(/^Pro, yearly\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0)
  await expectNoOffer(page)
})

test('the session stays in store mode on later pages', async ({ page }, testInfo) => {
  await preparePage(page, testInfo)
  await open(page, 'screen=dashboard&tier=guest')
  await open(page, 'screen=dashboard&tier=free', false)
  await expect(page.getByRole('button', { name: 'See the next 10 days with Pro' })).toHaveCount(0)
  await expectNoOffer(page)
})
