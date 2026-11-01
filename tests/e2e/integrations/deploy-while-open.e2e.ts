// A tab left open across a deploy (REVIEW10 VERIFY10 N2), in a production build with a
// (fake) Firebase project. Each Hosting release replaces every file, so the code an open
// page loads on demand is gone: here, once the page has loaded, every `/_next/static/`
// file it has not fetched yet answers 404, as after a deploy. Sign-in's code (Firebase)
// is among them. Solara must see that a newer version is live, reload once to it, say
// why, and then sign in normally; it must not blame the connection or reload in a loop.
import type { Page, Response, Route } from '@playwright/test'
import { startClock } from '../../harness/clock'
import { buildRawForecast } from '../../harness/fixtures'
import { expect, test } from './fixtures'

/** Text only the Firebase Auth SDK carries, to recognize its chunk (first-load.e2e.ts). */
const FIREBASE_AUTH_MARKER = 'argument-error'

const GUEST_PLAN = {
  prefs: {
    location: { lat: 34.05, lon: -118.24, city: 'Los Angeles', region: 'California' },
    skinType: 'fair',
    activities: [],
    onboardingComplete: true,
  },
  since: '2026-06-15',
}

test.beforeEach(async ({ page, network }) => {
  // Registered after the network fixture, so it answers before that blocks it.
  void network
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await page.addInitScript(plan => {
    localStorage.setItem('solara.analytics-consent.v1', 'declined')
    localStorage.setItem('solara_guest', JSON.stringify(plan))
  }, GUEST_PLAN)
  await startClock(page)
})

type Deploy = 'gone' | 'unreachable'

/**
 * Opens the app, then "deploys": every code file the page has not loaded yet is gone
 * (404) or cannot be reached (a network error), until the page navigates again, which
 * loads the new version (`untilReload`), or for good.
 */
async function openThenDeploy(page: Page, deploy: Deploy, { untilReload = true } = {}) {
  // The files of the version the page opened with, as loaded before the deploy only.
  const loaded = new Set<string>()
  const record = (response: Response) => {
    if (new URL(response.url()).pathname.startsWith('/_next/static/')) loaded.add(response.url())
  }
  page.on('response', record)
  await page.goto('/app/')
  await expect(page.getByRole('toolbar', { name: 'UV forecast by hour' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  page.off('response', record)
  const state = { deployed: true, refused: [] as string[], reloads: 0 }
  await page.route('**/*', async (route: Route) => {
    const request = route.request()
    if (request.isNavigationRequest()) {
      state.reloads += 1
      if (untilReload) state.deployed = false
      return route.fallback()
    }
    const url = request.url()
    if (state.deployed && new URL(url).pathname.startsWith('/_next/static/') && !loaded.has(url)) {
      state.refused.push(`${request.method()} ${url}`)
      return deploy === 'gone'
        ? route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' })
        : route.abort('internetdisconnected')
    }
    return route.fallback()
  })
  return state
}

/** Same-origin scripts downloaded from now on, to see Firebase's arrive. */
function trackScripts(page: Page, origin: string) {
  const bodies: Promise<Buffer>[] = []
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.url().startsWith(origin)) {
      bodies.push(response.body().catch(() => Buffer.alloc(0)))
    }
  })
  return async (text: string) => (await Promise.all(bodies)).some(body => body.includes(text))
}

test('sign-in after a deploy reloads once to the new version, then signs in', async ({
  page,
  baseURL,
}) => {
  const state = await openThenDeploy(page, 'gone')
  const signIn = page.getByRole('banner').getByRole('button', { name: 'Sign in' })
  await signIn.click()

  // The page reloads to the new version and says why, in place of a connection error.
  await expect(page.getByRole('status').filter({ hasText: 'Solara was updated' })).toHaveText(
    'Solara was updated while this page was open, so it reloaded. Choose Sign in again to continue.',
  )
  expect(state.reloads).toBe(1)
  expect(state.refused.some(request => request.startsWith('HEAD '))).toBe(true)
  await expect(page.getByText(/Check your connection/)).toHaveCount(0)
  // The guest's plan is still there.
  await expect(page.getByRole('toolbar', { name: 'UV forecast by hour' })).toBeVisible()

  // Sign-in's code now loads.
  const scripts = trackScripts(page, baseURL!)
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).hover()
  await expect.poll(() => scripts(FIREBASE_AUTH_MARKER)).toBe(true)

  // The notice goes away when dismissed, and does not come back on a later reload.
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('Solara was updated')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'UV forecast by hour' })).toBeVisible()
  await expect(page.getByText('Solara was updated')).toHaveCount(0)
})

test('a deploy that keeps failing is reloaded once, never in a loop', async ({ page }) => {
  const state = await openThenDeploy(page, 'gone', { untilReload: false })
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Solara was updated' })).toBeVisible()
  expect(state.reloads).toBe(1)

  // The new version's sign-in code fails too: no second reload, an accurate message.
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Solara was just updated. Reload the page to sign in.')).toBeVisible()
  expect(state.reloads).toBe(1)
})

test('without a connection, sign-in says so and nothing reloads', async ({ page }) => {
  const state = await openThenDeploy(page, 'unreachable')
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByText('Could not reach Google to sign in. Check your connection and try again.'),
  ).toBeVisible()
  expect(state.reloads).toBe(0)
})

test('opening a part of the app after a deploy reloads to the new version', async ({ page }) => {
  // Before the parts preload (REVIEW10 VERIFY10 N2's "Settings does nothing").
  await page.addInitScript(() => {
    // Data Saver: the deferred parts are not preloaded (preloadDeferred), as when the
    // deploy lands before they are.
    Object.defineProperty(navigator, 'connection', { value: { saveData: true } })
  })
  const state = await openThenDeploy(page, 'gone')
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Solara was updated' })).toHaveText(
    'Solara was updated while this page was open, so it reloaded.',
  )
  expect(state.reloads).toBe(1)
  // After the reload, Settings opens.
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
