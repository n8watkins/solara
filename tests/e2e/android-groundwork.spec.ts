import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// Android groundwork on the real export, served by the Firebase Hosting emulator with
// firebase.json (ROADMAP item 38, docs/integrations/ANDROID.md).

test.describe('a session opened by a Trusted Web Activity', () => {
  test('goes from the landing page to the app, which shows no price', async ({ page }) => {
    // A TWA's start URL carries ?source=twa; the landing page's prices never show.
    await page.goto('/?source=twa')
    await expect(page).toHaveURL(/\/app\/\?source=twa$/)
    await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()

    // The rest of the session stays in store mode, even on the landing page.
    await page.goto('/')
    await expect(page).toHaveURL(/\/app\/$/)
    await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
    await expect(page.locator('body')).not.toHaveText(/\$\d|waitlist/, {
      useInnerText: true,
    })
  })

  test('leaves the web landing page and its plans alone', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /Start free/ })).toBeVisible()
  })
})

test('Hosting serves /.well-known/ JSON as application/json', async ({ request }) => {
  // Stands in for assetlinks.json, which waits for the package name: the emulator serves
  // the export from disk with the real firebase.json, whose ignore drops dot files.
  const site = resolve(process.env.E2E_SITE_DIR || 'out')
  const dir = join(site, '.well-known')
  const name = `e2e-probe-${process.pid}.json`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), '[{"relation":["delegate_permission/common.handle_all_urls"]}]')
  try {
    const response = await request.get(`/.well-known/${name}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^application\/json\b/)
    expect(await response.json()).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'] },
    ])
  } finally {
    rmSync(join(dir, name), { force: true })
  }
})
