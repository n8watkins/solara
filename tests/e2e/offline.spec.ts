import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'
import { createStaticHandler } from '../static-server.mts'

// The installed app offline: the app-shell service worker (scripts/sw/shell.ts, built
// by scripts/build-sw.mjs) serves the pages and their files, and the app shows the
// last forecast from this browser's cache (lib/cache.ts) with when it was updated.
// The other suites block service workers (playwright.config.ts); these need them.
test.use({ serviceWorkers: 'allow' })

const GUEST_PLAN = {
  prefs: {
    location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
}

test.beforeEach(async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await startClock(page)
  await page.addInitScript(plan => {
    if (!localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', plan)
  }, JSON.stringify(GUEST_PLAN))
})

const forecast = (page: Page) => page.getByRole('group', { name: 'UV forecast by hour' })
const offlineNotice = (page: Page) => page.getByRole('status').filter({ hasText: "You're offline" })

/** Loads the app online and waits until the shell worker controls it (precache done). */
async function openWithShellWorker(page: Page) {
  await page.goto('/app/')
  await expect(forecast(page)).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

test('the app opens offline with the last forecast and when it was updated', async ({
  page,
  context,
}) => {
  await openWithShellWorker(page)
  await expect(offlineNotice(page)).toHaveCount(0)

  await context.setOffline(true)
  // The worker's own requests are offline too: a file it does not hold fails.
  const missing = await page.evaluate(() =>
    fetch('/_next/static/chunks/not-in-this-build.js').then(
      response => `answered ${response.status}`,
      () => 'failed',
    ),
  )
  expect(missing).toBe('failed')

  const reloaded = await page.reload()
  expect(reloaded?.fromServiceWorker()).toBe(true)
  await expect(forecast(page)).toBeVisible()
  await expect(offlineNotice(page)).toHaveText(
    "You're offline. Showing the forecast updated at 10:30am.",
  )

  // Back online, the notice goes.
  await context.setOffline(false)
  await expect(offlineNotice(page)).toHaveCount(0)
})

test('offline without a cached forecast, the app says it will load once online', async ({
  page,
  context,
}) => {
  await openWithShellWorker(page)
  await context.setOffline(true)
  await page.evaluate(() => localStorage.removeItem('solara_forecast'))
  await page.reload()
  await expect(offlineNotice(page)).toHaveText(
    "You're offline. The forecast will load when you're back online.",
  )
})

test('the shell worker never stores anything but the shell', async ({ page }) => {
  await openWithShellWorker(page)
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return { names: await caches.keys(), urls }
  })
  // One version: its precache and its runtime cache of hashed files.
  expect(cached.names.every(name => /^solara-(shell|static)-[0-9a-f]{16}$/.test(name))).toBe(true)
  const origin = new URL(page.url()).origin
  for (const url of cached.urls) {
    expect(url.startsWith(origin + '/'), url).toBe(true)
    expect(new URL(url).pathname, url).toMatch(
      /^\/(app\/)?$|^\/_next\/static\/|^\/[\w-]+\.(png|webmanifest)$|^\/landing\/[\w-]+\.webp$/,
    )
  }
})

test('pages always come from the network while online', async ({ page, context }) => {
  await openWithShellWorker(page)
  // A page the network changes after the worker cached it.
  await context.route('**/app/', async route => {
    const response = await route.fetch()
    const body = (await response.text()).replace('</body>', '<p id="fresh">fresh</p></body>')
    await route.fulfill({ response, body })
  })
  await page.reload()
  await expect(page.locator('#fresh')).toHaveCount(1)
})

test('a deploy replaces the worker and deletes the old caches', async ({ page, context }) => {
  // The export behind a server whose /sw.js the test controls, so a deploy can be
  // played: the same files under a new version.
  const site = resolve(process.env.E2E_SITE_DIR || 'out')
  const firstWorker = readFileSync(join(site, 'sw.js'), 'utf8')
  const newVersion = 'feedfacefeedface'
  let worker = firstWorker
  const files = createStaticHandler(site)
  const server = createServer((req, res) => {
    if (req.url?.split('?')[0] !== '/sw.js') return files(req, res)
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' })
    res.end(worker)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  try {
    await page.goto(`http://127.0.0.1:${port}/app/`)
    await expect(forecast(page)).toBeVisible()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    const shellCache = (await page.evaluate(() => caches.keys())).find(name =>
      name.startsWith('solara-shell-'),
    )
    const oldVersion = shellCache!.slice('solara-shell-'.length)
    expect(firstWorker).toContain(oldVersion)

    worker = firstWorker.replaceAll(oldVersion, newVersion)
    const takenOver = page.evaluate(
      () =>
        new Promise(done =>
          navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }),
        ),
    )
    // What the browser does on the next navigation.
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update()))
    await takenOver
    // The new worker controls the page as soon as it activates; activation then
    // deletes the old version's caches.
    await expect
      .poll(async () => {
        const names = await page.evaluate(() => caches.keys())
        const current = names.includes(`solara-shell-${newVersion}`)
        return current && !names.some(name => name.includes(oldVersion))
      }, 'only the new version is cached')
      .toBe(true)

    // The new version holds the whole shell.
    await context.setOffline(true)
    await page.reload()
    await expect(forecast(page)).toBeVisible()
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('the app is installable', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'installability is reported by Chromium')
  await openWithShellWorker(page)
  const cdp = await context.newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  expect(installabilityErrors).toEqual([])
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
  expect(manifest).toMatchObject({ start_url: '/app/', display: 'standalone' })
})
