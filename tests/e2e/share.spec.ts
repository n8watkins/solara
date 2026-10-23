import { expect, test } from '@playwright/test'

function isoDate(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('renders a valid shared plan with a date and keeps it out of search', async ({ page }) => {
  await page.goto(
    `/share/?a=Run&icon=%F0%9F%8F%83&city=Pasadena&region=California&date=${isoDate(1)}&from=7.5&to=8.5&uv=2.1`,
  )
  await expect(page.getByRole('heading', { level: 1, name: 'Run' })).toBeVisible()
  await expect(page.getByText(/Tomorrow · 7:30am–8:30am · Pasadena, California/)).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Plan your own lower-UV window' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open-Meteo' })).toBeVisible()
})

test('flags a plan whose date has passed', async ({ page }) => {
  await page.goto(`/share/?a=Run&city=Pasadena&date=${isoDate(-3)}&from=7&to=8`)
  await expect(page.getByRole('status')).toContainText('has passed')
})

test('refuses to render link text that looks like a phishing lure', async ({ page }) => {
  await page.goto(
    `/share/?a=${encodeURIComponent('Your account is locked visit evil.example.com')}&city=Support&date=${isoDate(0)}&from=8&to=9`,
  )
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "This shared link can't be shown",
  )
  await expect(page.getByText('evil.example.com')).toHaveCount(0)
})

test.describe('in a 24-hour locale', () => {
  test.use({ locale: 'en-GB' })

  test("shows the plan's times on the viewer's clock", async ({ page }) => {
    await page.goto(`/share/?a=Run&city=Pasadena&date=${isoDate(1)}&from=7.5&to=18`)
    await expect(page.getByText(/Tomorrow · 07:30–18:00 · Pasadena/)).toBeVisible()
    await expect(page.getByText('07:30–18:00', { exact: true })).toBeVisible()
  })
})

test("a viewer's saved clock choice wins over the locale", async ({ page }) => {
  // What Solara keeps on a device where someone chose the 24-hour clock in Settings.
  await page.addInitScript(() => {
    localStorage.setItem(
      'solara_prefs',
      JSON.stringify({
        uid: 'viewer',
        location: { lat: 34.15, lon: -118.14, city: 'Pasadena', region: 'California' },
        skinType: 'fair',
        sunscreen: false,
        activities: [],
        tier: 'free',
        onboardingComplete: true,
        clockFormat: '24h',
      }),
    )
  })
  await page.goto(`/share/?a=Run&city=Pasadena&date=${isoDate(1)}&from=7.5&to=18`)
  await expect(page.getByText(/Tomorrow · 07:30–18:00 · Pasadena/)).toBeVisible()
})
