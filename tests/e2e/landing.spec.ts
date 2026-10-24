import { expect, test } from '@playwright/test'

// The landing page at `/`: static, with no framework JavaScript and nothing from
// Firebase, and a straight path into the app (decision D7, W3-C).

test('is static: no scripts beyond its own inline ones, nothing off the site', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Know when to go outside' }),
  ).toBeVisible()
  await page.waitForLoadState('networkidle')

  await expect(page.locator('script[src]')).toHaveCount(0)
  const origin = new URL(page.url()).origin
  expect(requests.filter(url => !url.startsWith(origin))).toEqual([])
  expect(requests.filter(url => url.endsWith('.js'))).toEqual([])
  // No consent banner: the landing page loads no analytics to ask about.
  await expect(page.getByRole('region', { name: 'Help improve Solara' })).toHaveCount(0)
})

test('offers the app, sign-in, the plans, the legal pages and the data credits', async ({
  page,
}) => {
  await page.goto('/')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: 'Try it now' }).first()).toHaveAttribute(
    'href',
    '/app/',
  )
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/app/?signin',
  )
  await expect(main.getByText('$2.99')).toBeVisible()
  await expect(main.getByText(/\$19\.99 a year\. 7-day free trial/)).toBeVisible()
  await expect(main.getByText('Morning alerts (coming soon)')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy/')
  await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms/')
  await expect(page.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
    'href',
    'https://open-meteo.com/',
  )
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Solara on a phone/ })).toBeVisible()

  await main.getByRole('link', { name: 'Try it now' }).first().click()
  await expect(page).toHaveURL(/\/app\/$/)
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
})

test('"Sign in" opens the sign-in screen, which also leads to setup', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Solara' })).toBeVisible()
  // The flag is read once and dropped from the address.
  await expect(page).toHaveURL(/\/app\/$/)
  await page.getByRole('button', { name: /Continue without signing in/ }).click()
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
})

test('a browser with a Solara account goes straight to the app', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solara_account_owner', 'someone'))
  await page.goto('/?checkout=canceled#top')
  await expect(page).toHaveURL(/\/app\/\?checkout=canceled#top$/)
})
