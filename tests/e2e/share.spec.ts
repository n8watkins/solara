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
