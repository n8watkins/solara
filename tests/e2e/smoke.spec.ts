import { expect, test } from '@playwright/test'

// Tagged @smoke: deploy.yml runs only these against the production artifact
// (E2E_SITE_DIR=out) before deploying it, so they must hold for any public env,
// with or without a Firebase project configured.

test('serves the export with the Hosting headers', { tag: '@smoke' }, async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')

  await expect(page).toHaveTitle(/Solara/)
  await expect(page.getByRole('heading', { name: 'Know when to go outside' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try it now' }).first()).toHaveAttribute(
    'href',
    '/app/',
  )
})

test('serves hashed assets as immutable', { tag: '@smoke' }, async ({ page, request }) => {
  // The app; the landing page ships no framework scripts.
  await page.goto('/app/')
  const script = await page.locator('script[src^="/_next/static/"]').first().getAttribute('src')
  expect(script).toBeTruthy()

  const asset = await request.get(script ?? '')
  expect(asset.status()).toBe(200)
  expect(asset.headers()['cache-control']).toContain('immutable')
})

test('serves the service workers uncached', { tag: '@smoke' }, async ({ request }) => {
  // A long-cached worker would keep a deploy from reaching anyone (scripts/build-sw.mjs).
  for (const path of ['/sw.js', '/firebase-messaging-sw.js']) {
    const worker = await request.get(path)
    expect(worker.status(), path).toBe(200)
    expect(worker.headers()['content-type'], path).toContain('javascript')
    expect(worker.headers()['cache-control'], path).toBe('no-cache')
  }
  // The shell worker stays small and free of Firebase; the push worker carries it.
  const shell = await (await request.get('/sw.js')).text()
  expect(shell.length).toBeLessThan(16 * 1024)
  expect(shell).not.toContain('firebase')
  expect(shell).toContain('solara-shell-')
})
