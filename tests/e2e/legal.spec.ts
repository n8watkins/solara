import { expect, test } from '@playwright/test'
import { LEGAL_DETAILS } from '../../lib/legal'

test('privacy policy names the operator or shows a clearly marked placeholder', async ({
  page,
}) => {
  await page.goto('/privacy/')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Who runs Solara' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your rights' })).toBeVisible()
  const operator = LEGAL_DETAILS.operatorName
  if (operator) await expect(page.getByText(operator).first()).toBeVisible()
  else
    await expect(page.locator('[data-legal-placeholder="operatorName"]').first()).toHaveText(
      '[Placeholder: operator name]',
    )
})

test('unknown paths render the not-found page with a 404 status', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist/')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Solara' })).toHaveAttribute('href', '/')
})
