import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// The default e2e build has no NEXT_PUBLIC_SENTRY_DSN and no
// NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY (playwright.config.ts), like production
// until the owner provides them. Neither integration may then ship code that runs
// or make a single request. tests/e2e/integrations covers the switched-on builds.

const SITE_DIR = resolve(process.env.E2E_SITE_DIR || 'out')
const THIRD_PARTY = /sentry|recaptcha|firebaseappcheck/i

function exportFiles(): string[] {
  return readdirSync(SITE_DIR, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
}

// Tagged @smoke: deploy.yml also runs it against the production artifact, which
// holds for any env because the deploy workflow deletes the maps it uploads to Sentry.
test('publishes no source maps', { tag: '@smoke' }, async ({ page, request }) => {
  expect(exportFiles().filter(file => file.endsWith('.map'))).toEqual([])
  await page.goto('/')
  const scripts = await page
    .locator('script[src^="/_next/static/"]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('src') ?? ''))
  expect(scripts.length).toBeGreaterThan(0)
  for (const script of scripts) {
    expect((await request.get(`${script}.map`)).status(), `${script}.map`).toBe(404)
    const text = await (await request.get(script)).text()
    expect(text, script).not.toMatch(/^\/\/# sourceMappingURL=/m)
  }
})

test('the export contains no Sentry SDK and no Sentry host', () => {
  const files = exportFiles()
  const scripts = files.filter(file => file.endsWith('.js'))
  expect(scripts.filter(file => /__SENTRY__|sentry\.io/.test(readFileSync(file, 'utf8')))).toEqual(
    [],
  )
  // The privacy policy names Sentry, so pages are checked for the SDK and the CSP only.
  for (const file of files.filter(name => name.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8')
    expect(html, file).not.toContain('__SENTRY__')
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(policy, file).not.toContain('sentry')
  }
})

test('pages make no Sentry, reCAPTCHA or App Check requests', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  for (const path of ['/', '/privacy/', '/terms/', '/account/', '/share/']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    // An uncaught error is exactly when error reporting would send something.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('switched-off integrations check')
      })
    })
  }
  await page.waitForLoadState('networkidle')
  expect(requests.filter(url => THIRD_PARTY.test(url))).toEqual([])
  await expect(page.locator('script[src*="recaptcha"]')).toHaveCount(0)
  expect(await page.evaluate(() => '__SENTRY__' in globalThis)).toBe(false)
})
